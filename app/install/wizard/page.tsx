'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Shield } from 'lucide-react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';

type InstallerMeta = {
  enabled: boolean;
  requiresToken: boolean;
};

type ProjectInfo = {
  id: string;
  name: string;
  teamId?: string;
  url?: string;
};

type SupabaseProjectOption = {
  ref: string;
  name: string;
  region?: string;
  status?: string;
  supabaseUrl: string;
  organizationSlug?: string;
};

type SupabaseOrgOption = { slug: string; name: string; id?: string; plan?: string };

type Step = {
  id: string;
  status: 'ok' | 'error' | 'warning' | 'running';
  message?: string;
};

type FunctionResult =
  | { slug: string; ok: true; response: unknown }
  | { slug: string; ok: false; error: string; status?: number; response?: unknown };

type RunResult = {
  ok: boolean;
  steps: Step[];
  functions?: FunctionResult[];
  error?: string;
};

const wizardSteps = [
  { id: 'vercel', label: 'Vercel' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'admin', label: 'Admin' },
  { id: 'review', label: 'Review' },
];

const STORAGE_TOKEN = 'crm_install_token';
const STORAGE_PROJECT = 'crm_install_project';
const STORAGE_INSTALLER_TOKEN = 'crm_install_installer_token';

const shouldShowTokenHelp = (message: string) => {
  const text = message.toLowerCase();
  return text.includes('vercel') && text.includes('token');
};

function maskValue(value: string, start = 4, end = 4) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= start + end) return `${trimmed.slice(0, start)}...`;
  return `${trimmed.slice(0, start)}...${trimmed.slice(-end)}`;
}

function generateStrongSupabaseDbPass(length = 20) {
  // Safe character set (avoid quotes/backslashes to reduce copy/paste headaches)
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
  const n = Math.max(12, Math.min(64, length));
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function suggestSupabaseProjectName(existingNames: string[]) {
  const base = 'nossocrm';
  const lower = new Set(
    existingNames.map((n) => (n || '').toLowerCase().trim()).filter(Boolean)
  );
  if (!lower.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!lower.has(candidate)) return candidate;
  }
  return `${base}-${Math.floor(Date.now() / 1000)}`;
}

function humanizeSupabaseCreateError(message: string) {
  const lower = String(message || '').toLowerCase();
  if (
    lower.includes('maximum limits') ||
    lower.includes('2 project limit') ||
    lower.includes('limit of 2 active projects')
  ) {
    return 'Essa organização atingiu o limite do Free (2 projetos ativos para admins/owners). Para continuar: pause 1 projeto ativo (reversível), ou delete 1 (permanente), ou escolha um projeto existente.';
  }
  return message;
}

function buildSupabaseDbUrlFromPassword(input: {
  projectRef: string;
  dbPassword: string;
  mode: 'direct' | 'transaction_pooler';
}) {
  const ref = input.projectRef.trim();
  const pass = input.dbPassword.trim();
  const host = `db.${ref}.supabase.co`;
  const port = input.mode === 'transaction_pooler' ? 6543 : 5432;
  const qs =
    input.mode === 'transaction_pooler' ? 'sslmode=require&pgbouncer=true' : 'sslmode=require';
  // Supabase docs typically use `postgres` as the default user for direct/pooler connection strings.
  return `postgresql://postgres:${encodeURIComponent(pass)}@${host}:${port}/postgres?${qs}`;
}

/**
 * Componente React `InstallWizardPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function InstallWizardPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<InstallerMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const inferProjectRefFromSupabaseUrl = (value: string): string | null => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const m1 = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
      if (m1?.[1]) return m1[1];
      const m2 = host.match(/^([a-z0-9-]+)\.supabase\.in$/i);
      if (m2?.[1]) return m2[1];
      return null;
    } catch {
      return null;
    }
  };

  const [installerToken, setInstallerToken] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseServiceKey, setSupabaseServiceKey] = useState('');
  const [supabaseDbUrl, setSupabaseDbUrl] = useState('');
  const [supabaseAccessToken, setSupabaseAccessToken] = useState('');
  const [supabaseProjectRef, setSupabaseProjectRef] = useState('');
  const [supabaseProjectRefTouched, setSupabaseProjectRefTouched] = useState(false);
  const [supabaseDeployEdgeFunctions, setSupabaseDeployEdgeFunctions] = useState(true);
  const [supabaseAdvanced, setSupabaseAdvanced] = useState(false);
  const [supabaseResolving, setSupabaseResolving] = useState(false);
  const [supabaseResolveError, setSupabaseResolveError] = useState<string | null>(null);
  const [supabaseResolvedOk, setSupabaseResolvedOk] = useState(false);
  const [supabaseResolvedLabel, setSupabaseResolvedLabel] = useState<string | null>(null);
  const supabaseAutoResolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabaseAutoResolveAttemptsRef = useRef(0);
  const [supabaseMode, setSupabaseMode] = useState<'existing' | 'create'>('create');
  const [supabaseUiStep, setSupabaseUiStep] = useState<'pat' | 'project' | 'final'>('pat');
  const [supabasePatAutoAdvanced, setSupabasePatAutoAdvanced] = useState(false);
  const [supabaseProjectsLoading, setSupabaseProjectsLoading] = useState(false);
  const [supabaseProjectsError, setSupabaseProjectsError] = useState<string | null>(null);
  const [supabaseProjects, setSupabaseProjects] = useState<SupabaseProjectOption[]>([]);
  const [supabaseSelectedProjectRef, setSupabaseSelectedProjectRef] = useState('');
  const [supabaseProjectsLoadedForPat, setSupabaseProjectsLoadedForPat] = useState<string>('');
  const [supabaseGlobalProjectsLoading, setSupabaseGlobalProjectsLoading] = useState(false);
  const [supabaseGlobalProjectsError, setSupabaseGlobalProjectsError] = useState<string | null>(null);
  const [supabasePreflightLoading, setSupabasePreflightLoading] = useState(false);
  const [supabasePreflightError, setSupabasePreflightError] = useState<string | null>(null);
  const [supabasePreflight, setSupabasePreflight] = useState<{
    freeGlobalActiveCount: number;
    freeGlobalLimitHit: boolean;
    suggestedOrganizationSlug: string | null;
    organizations: Array<{
      slug: string;
      name: string;
      plan?: string;
      activeCount: number;
      activeProjects: Array<SupabaseProjectOption>;
    }>;
  } | null>(null);

  const [supabaseOrgsLoading, setSupabaseOrgsLoading] = useState(false);
  const [supabaseOrgsError, setSupabaseOrgsError] = useState<string | null>(null);
  const [supabaseOrgs, setSupabaseOrgs] = useState<SupabaseOrgOption[]>([]);
  const [supabaseCreateOrgSlug, setSupabaseCreateOrgSlug] = useState('');
  const [supabaseSelectedOrgSlug, setSupabaseSelectedOrgSlug] = useState('');
  const [supabaseSelectedOrgPlan, setSupabaseSelectedOrgPlan] = useState<string | null>(null);
  const [supabaseOrgProjectsLoading, setSupabaseOrgProjectsLoading] = useState(false);
  const [supabaseOrgProjectsError, setSupabaseOrgProjectsError] = useState<string | null>(null);
  const [supabaseOrgProjects, setSupabaseOrgProjects] = useState<SupabaseProjectOption[]>([]);
  const [supabaseOrgProjectsLoadedKey, setSupabaseOrgProjectsLoadedKey] = useState<string>('');
  const [supabaseProjectActionRef, setSupabaseProjectActionRef] = useState<string | null>(null);
  const [supabaseDeleteConfirmRef, setSupabaseDeleteConfirmRef] = useState('');
  const [supabaseCreateName, setSupabaseCreateName] = useState('');
  const [supabaseCreateDbPass, setSupabaseCreateDbPass] = useState('');
  const [supabaseDbPassCopied, setSupabaseDbPassCopied] = useState(false);
  const [supabaseFreeWallExpanded, setSupabaseFreeWallExpanded] = useState(false);
  const [supabaseAutoCreateAfterFreeSlot, setSupabaseAutoCreateAfterFreeSlot] = useState(false);
  const [supabaseCreateRegion, setSupabaseCreateRegion] = useState<'americas' | 'emea' | 'apac'>('americas');
  const [supabaseCreating, setSupabaseCreating] = useState(false);
  const [supabaseCreateError, setSupabaseCreateError] = useState<string | null>(null);

  const [edgeFunctionsPreview, setEdgeFunctionsPreview] = useState<
    Array<{ slug: string; verify_jwt: boolean }>
  >([]);
  const [edgeFunctionsPreviewLoading, setEdgeFunctionsPreviewLoading] = useState(false);
  const [edgeFunctionsPreviewError, setEdgeFunctionsPreviewError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // “Padrão ouro”: aplicar envs tanto em Production quanto em Preview.
  // O usuário não precisa escolher isso (evita erro humano).
  const selectedTargets = useMemo(() => ['production', 'preview'] as const, []);
  const [currentStep, setCurrentStep] = useState(0);

  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Cinematic: subtle parallax (desktop-first). Kept tiny to avoid nausea.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const mxSpring = useSpring(mx, { stiffness: 120, damping: 30, mass: 0.6 });
  const mySpring = useSpring(my, { stiffness: 120, damping: 30, mass: 0.6 });

  const setParallaxFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width - 0.5; // [-0.5..0.5]
    const dy = (e.clientY - rect.top) / rect.height - 0.5;
    mx.set(dx * 14);
    my.set(dy * 10);
  };

  const clearParallax = () => {
    mx.set(0);
    my.set(0);
  };

  const TEAL = {
    // Acento local do installer (não mexe no tema global).
    solid: 'bg-cyan-600 hover:bg-cyan-500',
    solidText: 'text-cyan-600 dark:text-cyan-400',
    ring: 'focus:ring-cyan-400/30 focus:border-cyan-400',
    gradient: 'bg-linear-to-r from-cyan-400 to-teal-400',
  } as const;

  const sceneVariants = {
    initial: { opacity: 0, y: 10, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -6, filter: 'blur(4px)' },
  } as const;

  const sceneTransition = {
    type: 'tween',
    ease: [0.22, 1, 0.36, 1], // cinematic ease-out
    duration: 0.32,
  } as const;

  const chapter = useMemo(() => {
    // Capítulos Interstellar (pt-BR), estilo A + B1.
    // Agora é um capítulo por passo do wizard (cena), não por sub-etapa do Supabase.
    if (currentStep === 0) {
      return {
        title: 'Capítulo 1 — Autorização',
        subtitle: 'Confirmando acesso para iniciar a jornada.',
        micro: 'Tudo começa com uma chave.',
      };
    }
    if (currentStep === 1) {
      return {
        title: 'Capítulo 2 — Destino',
        subtitle: 'Escolha onde vamos pousar (seu projeto Supabase).',
        micro: 'Onde nasce seu novo mundo.',
      };
    }
    if (currentStep === 2) {
      return {
        title: 'Capítulo 3 — Sincronização',
        subtitle: 'Alinhando equipe e ambiente.',
        micro: 'Tudo no lugar.',
      };
    }
    return {
      title: 'Capítulo 4 — Primeiro contato',
      subtitle: 'Tudo pronto para entrar no novo mundo.',
      micro: 'Agora começa.',
    };
  }, [currentStep]);

  const expectedInstallTimeline = useMemo(
    () => [
      { id: 'vercel_envs', label: 'Vercel — Variáveis de ambiente' },
      { id: 'supabase_migrations', label: 'Supabase — Migrações' },
      { id: 'supabase_bootstrap', label: 'Supabase — Bootstrap' },
      { id: 'supabase_edge_functions', label: 'Supabase — Edge Functions' },
      { id: 'vercel_redeploy', label: 'Vercel — Redeploy' },
    ],
    []
  );

  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [cineTimelineIndex, setCineTimelineIndex] = useState(0);
  const [cineCanClose, setCineCanClose] = useState(false);
  const [cineStartedAtMs, setCineStartedAtMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/installer/meta');
        const data = await res.json();
        if (!cancelled) setMeta(data);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load installer metadata';
          setMetaError(message);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem(STORAGE_TOKEN);
    const savedProject = localStorage.getItem(STORAGE_PROJECT);
    const savedInstallerToken = localStorage.getItem(STORAGE_INSTALLER_TOKEN);

    if (!savedToken || !savedProject) {
      router.replace('/install/start');
      return;
    }

    try {
      const parsedProject = JSON.parse(savedProject) as ProjectInfo;
      setVercelToken(savedToken);
      setProject(parsedProject);
      if (savedInstallerToken) setInstallerToken(savedInstallerToken);
      setIsHydrated(true);
    } catch {
      localStorage.removeItem(STORAGE_PROJECT);
      router.replace('/install/start');
    }
  }, [router]);

  useEffect(() => {
    if (installerToken.trim()) {
      localStorage.setItem(STORAGE_INSTALLER_TOKEN, installerToken.trim());
    }
  }, [installerToken]);

  useEffect(() => {
    if (supabaseProjectRefTouched) return;
    const inferred = inferProjectRefFromSupabaseUrl(supabaseUrl.trim());
    if (inferred) setSupabaseProjectRef(inferred);
  }, [supabaseProjectRefTouched, supabaseUrl]);

  const clearSupabaseAutoResolveTimer = () => {
    const handle = supabaseAutoResolveTimerRef.current;
    if (!handle) return;
    clearTimeout(handle);
    supabaseAutoResolveTimerRef.current = null;
  };

  useEffect(() => {
    // If the user changes the base inputs, we should consider the previous resolution stale.
    clearSupabaseAutoResolveTimer();
    supabaseAutoResolveAttemptsRef.current = 0;
    setSupabaseResolvedOk(false);
    setSupabaseResolvedLabel(null);
  }, [supabaseUrl, supabaseAccessToken, supabaseProjectRef]);

  useEffect(() => {
    // “Bruxaria”: se PAT + (URL ou projectRef) estiverem preenchidos, tenta auto-preencher com debounce.
    if (!supabaseAccessToken.trim()) return;
    if (!supabaseUrl.trim() && !supabaseProjectRef.trim()) return;
    if (supabaseResolving || supabaseResolvedOk) return;

    clearSupabaseAutoResolveTimer();
    supabaseAutoResolveTimerRef.current = setTimeout(() => {
      void resolveSupabase('auto');
    }, 650);

    return () => clearSupabaseAutoResolveTimer();
  }, [supabaseUrl, supabaseAccessToken, supabaseProjectRef, supabaseResolving, supabaseResolvedOk]);

  const passwordValid = adminPassword.length >= 6;
  const passwordsMatch =
    adminPassword.length > 0 && adminPassword === confirmPassword;

  const vercelReady = Boolean(
    (!meta?.requiresToken || installerToken.trim()) &&
      vercelToken.trim() &&
      project?.id &&
      selectedTargets.length > 0
  );

  const supabaseReady = Boolean(
    supabaseUrl.trim() &&
      // Either "magic" (PAT) or fully manual (keys + dbUrl)
      (supabaseAccessToken.trim() ||
        (supabaseAnonKey.trim() && supabaseServiceKey.trim() && supabaseDbUrl.trim())) &&
      // If Edge Functions are enabled, PAT is mandatory.
      (!supabaseDeployEdgeFunctions || supabaseAccessToken.trim())
  );

  const adminReady = Boolean(
    companyName.trim() && adminEmail.trim() && passwordValid && passwordsMatch
  );

  const canInstall = Boolean(meta?.enabled && vercelReady && supabaseReady && adminReady);
  const stepReady = [vercelReady, supabaseReady, adminReady, canInstall];

  const runInstaller = async () => {
    if (!canInstall || installing || !project) return;
    setInstalling(true);
    setRunError(null);
    setResult(null);
    setShowInstallOverlay(true);
    setCineCanClose(false);
    setCineTimelineIndex(0);
    setCineStartedAtMs(Date.now());

    try {
      const res = await fetch('/api/installer/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          vercel: {
            token: vercelToken.trim(),
            teamId: project.teamId,
            projectId: project.id,
            targets: selectedTargets,
          },
          supabase: {
            url: supabaseUrl.trim(),
            anonKey: supabaseAnonKey.trim() || undefined,
            serviceRoleKey: supabaseServiceKey.trim() || undefined,
            dbUrl: supabaseDbUrl.trim() || undefined,
            accessToken: supabaseAccessToken.trim() || undefined,
            projectRef: supabaseProjectRef.trim() || undefined,
            deployEdgeFunctions: supabaseDeployEdgeFunctions,
          },
          admin: {
            companyName: companyName.trim(),
            email: adminEmail.trim(),
            password: adminPassword,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Installer failed (HTTP ${res.status})`);
      }
      setResult(data as RunResult);
      if (!data?.ok && data?.error) {
        setRunError(data.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Installer failed';
      setRunError(message);
    } finally {
      setInstalling(false);
      setCineCanClose(true);
    }
  };

  useEffect(() => {
    if (!showInstallOverlay) return;
    if (!installing) return;

    // “Bruxaria” controlada: timeline animada (sem prometer sucesso) enquanto o backend trabalha.
    const t0 = Date.now();
    const tick = () => {
      const elapsed = Date.now() - t0;
      // avança devagar, sem correr até o fim (deixa espaço pro resultado real)
      const nextIndex = Math.min(
        Math.floor(elapsed / 900),
        Math.max(0, expectedInstallTimeline.length - 2)
      );
      setCineTimelineIndex(nextIndex);
    };

    tick();
    const handle = setInterval(tick, 220);
    return () => clearInterval(handle);
  }, [expectedInstallTimeline.length, installing, showInstallOverlay]);

  const statusColor = (status: Step['status']) => {
    switch (status) {
      case 'ok':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'warning':
        return 'text-amber-600 dark:text-amber-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-slate-500 dark:text-slate-400';
    }
  };

  const redeployWarning =
    result?.steps?.find((step) => step.id === 'vercel_redeploy' && step.status === 'warning') ||
    null;

  const progress =
    wizardSteps.length > 1
      ? Math.round((currentStep / (wizardSteps.length - 1)) * 100)
      : 0;

  const goNext = () => {
    if (!stepReady[currentStep]) return;
    setCurrentStep((step) => Math.min(step + 1, wizardSteps.length - 1));
  };

  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const resolveSupabase = async (mode: 'manual' | 'auto' = 'manual') => {
    if (supabaseResolving) return;
    const pat = supabaseAccessToken.trim();
    const url = supabaseUrl.trim();
    const ref = supabaseProjectRef.trim();

    if (!pat) {
      if (mode === 'manual') {
        setSupabaseResolveError('Cole seu Supabase PAT para continuar.');
        setSupabaseAdvanced(true);
      }
      return;
    }

    if (!url && !ref) {
      if (mode === 'manual') {
        setSupabaseResolveError('Selecione um projeto (ou informe a URL/ref) para resolver as chaves.');
        setSupabaseAdvanced(true);
      }
      return;
    }

    clearSupabaseAutoResolveTimer();
    setSupabaseResolveError(null);
    setSupabaseResolving(true);
    setSupabaseResolvedOk(false);
    setSupabaseResolvedLabel(null);

    try {
      const res = await fetch('/api/installer/supabase/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: pat,
          supabaseUrl: url || undefined,
          projectRef: ref || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Falha ao resolver Supabase (HTTP ${res.status})`);
      }

      if (data?.projectRef && !supabaseProjectRefTouched) {
        setSupabaseProjectRef(String(data.projectRef));
      }
      if (typeof data?.publishableKey === 'string') setSupabaseAnonKey(data.publishableKey);
      if (typeof data?.secretKey === 'string') setSupabaseServiceKey(data.secretKey);
      if (typeof data?.dbUrl === 'string') setSupabaseDbUrl(data.dbUrl);

      const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
      const apiDbUrl = typeof data?.dbUrl === 'string' ? String(data.dbUrl).trim() : '';
      const effectiveDbUrl = supabaseDbUrl.trim() || apiDbUrl;
      const hasDbUrl = Boolean(effectiveDbUrl);
      const isOnlyDbWarnings =
        warnings.length > 0 &&
        warnings.every((w) => String(w || '').toLowerCase().startsWith('db:'));

      // Auto-retry controlado: alguns projetos novos demoram para liberar a conexão do DB.
      // Tentamos algumas vezes com backoff; depois paramos e deixamos o usuário decidir.
      const MAX_AUTO_DB_RETRIES = 6;
      const AUTO_DB_RETRY_DELAYS_MS = [700, 1200, 2000, 3200, 5000, 8000];

      if (warnings.length > 0) {
        // If we already have a DB URL (manual or from create flow), treat DB warnings as non-blocking.
        if (isOnlyDbWarnings && hasDbUrl) {
          supabaseAutoResolveAttemptsRef.current = 0;
          const pubType =
            typeof data?.publishableKeyType === 'string' ? String(data.publishableKeyType) : 'publishable/anon';
          const secType =
            typeof data?.secretKeyType === 'string' ? String(data.secretKeyType) : 'secret/service_role';
          setSupabaseResolvedOk(true);
          setSupabaseResolvedLabel(`OK — chaves (${pubType}/${secType}) resolvidas (DB já definido)`);
          setSupabaseAdvanced(false);
          return;
        }

        if (mode === 'auto' && isOnlyDbWarnings && !hasDbUrl) {
          supabaseAutoResolveAttemptsRef.current += 1;
          const attempt = supabaseAutoResolveAttemptsRef.current;
          const remaining = Math.max(0, MAX_AUTO_DB_RETRIES - attempt);

          setSupabaseResolveError(
            `Aguardando o banco ficar pronto… (${attempt}/${MAX_AUTO_DB_RETRIES}). ${
              remaining > 0 ? 'Tentando novamente já já.' : 'Você pode tentar novamente ou preencher o DB manualmente.'
            }`
          );
          setSupabaseAdvanced(true);

          if (attempt < MAX_AUTO_DB_RETRIES) {
            const delay = AUTO_DB_RETRY_DELAYS_MS[Math.min(attempt - 1, AUTO_DB_RETRY_DELAYS_MS.length - 1)];
            supabaseAutoResolveTimerRef.current = setTimeout(() => {
              void resolveSupabase('auto');
            }, delay);
          }
          return;
        }

        setSupabaseResolveError(`Alguns itens não foram resolvidos: ${warnings.join(' | ')}`);
        setSupabaseAdvanced(true);
      } else {
        supabaseAutoResolveAttemptsRef.current = 0;
        const pubType =
          typeof data?.publishableKeyType === 'string' ? String(data.publishableKeyType) : 'publishable/anon';
        const secType =
          typeof data?.secretKeyType === 'string' ? String(data.secretKeyType) : 'secret/service_role';

        setSupabaseResolvedOk(true);
        setSupabaseResolvedLabel(`OK — chaves (${pubType}/${secType}) e DB resolvidos`);
        setSupabaseAdvanced(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao resolver Supabase';
      setSupabaseResolveError(message);
      setSupabaseAdvanced(true);
    } finally {
      setSupabaseResolving(false);
    }
  };

  const loadSupabaseProjects = async () => {
    if (supabaseProjectsLoading) return;
    setSupabaseProjectsError(null);
    setSupabaseProjectsLoading(true);
    try {
      const res = await fetch('/api/installer/supabase/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao listar projetos (HTTP ${res.status})`);
      setSupabaseProjects((data?.projects || []) as SupabaseProjectOption[]);
      setSupabaseProjectsLoadedForPat(supabaseAccessToken.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar projetos';
      setSupabaseProjectsError(message);
    } finally {
      setSupabaseProjectsLoading(false);
    }
  };

  const loadSupabaseGlobalProjectsForPreflight = async () => {
    if (supabaseGlobalProjectsLoading) return;
    setSupabaseGlobalProjectsError(null);
    setSupabaseGlobalProjectsLoading(true);
    try {
      await loadSupabaseProjects();
      setSupabaseGlobalProjectsError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar projetos (preflight)';
      setSupabaseGlobalProjectsError(message);
    } finally {
      setSupabaseGlobalProjectsLoading(false);
    }
  };

  const loadSupabasePreflight = async () => {
    if (supabasePreflightLoading) return;
    setSupabasePreflightError(null);
    setSupabasePreflightLoading(true);
    try {
      const res = await fetch('/api/installer/supabase/preflight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha no preflight (HTTP ${res.status})`);
      setSupabasePreflight({
        freeGlobalActiveCount: Number(data?.freeGlobalActiveCount || 0),
        freeGlobalLimitHit: Boolean(data?.freeGlobalLimitHit),
        suggestedOrganizationSlug:
          typeof data?.suggestedOrganizationSlug === 'string' ? data.suggestedOrganizationSlug : null,
        organizations: Array.isArray(data?.organizations) ? (data.organizations as any) : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no preflight';
      setSupabasePreflightError(message);
    } finally {
      setSupabasePreflightLoading(false);
    }
  };

  const loadSupabaseOrganizationProjects = async (organizationSlug: string, statuses?: string[]) => {
    if (supabaseOrgProjectsLoading) return;
    setSupabaseOrgProjectsError(null);
    setSupabaseOrgProjectsLoading(true);
    try {
      const res = await fetch('/api/installer/supabase/organization-projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
          organizationSlug,
          statuses,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao listar projetos da org (HTTP ${res.status})`);

      const org = data?.organization;
      const plan = typeof org?.plan === 'string' ? org.plan : null;
      setSupabaseSelectedOrgPlan(plan);

      setSupabaseOrgProjects((data?.projects || []) as SupabaseProjectOption[]);
      setSupabaseOrgProjectsLoadedKey(`${supabaseAccessToken.trim()}::${organizationSlug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar projetos da org';
      setSupabaseOrgProjectsError(message);
      // Evita loop infinito de auto-fetch quando o erro é persistente (ex.: payload 400).
      setSupabaseOrgProjectsLoadedKey(`${supabaseAccessToken.trim()}::${organizationSlug}`);
    } finally {
      setSupabaseOrgProjectsLoading(false);
    }
  };

  const pauseSupabaseProject = async (projectRef: string) => {
    if (supabaseProjectActionRef) return;
    setSupabaseProjectActionRef(projectRef);
    try {
      const res = await fetch('/api/installer/supabase/pause-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
          projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao pausar projeto (HTTP ${res.status})`);
      if (supabaseSelectedOrgSlug) {
        await loadSupabaseOrganizationProjects(supabaseSelectedOrgSlug, undefined);
      }
      // Atualiza contagem global (limite Free pode ser global por conta)
      void loadSupabaseGlobalProjectsForPreflight();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao pausar projeto';
      setSupabaseOrgProjectsError(message);
    } finally {
      setSupabaseProjectActionRef(null);
    }
  };

  const deleteSupabaseProject = async (projectRef: string) => {
    if (supabaseProjectActionRef) return;
    setSupabaseProjectActionRef(projectRef);
    try {
      const res = await fetch('/api/installer/supabase/delete-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
          projectRef,
          confirmRef: supabaseDeleteConfirmRef.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao deletar projeto (HTTP ${res.status})`);
      setSupabaseDeleteConfirmRef('');
      if (supabaseSelectedOrgSlug) {
        await loadSupabaseOrganizationProjects(supabaseSelectedOrgSlug, undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao deletar projeto';
      setSupabaseOrgProjectsError(message);
    } finally {
      setSupabaseProjectActionRef(null);
    }
  };

  const loadSupabaseOrgs = async () => {
    if (supabaseOrgsLoading) return;
    setSupabaseOrgsError(null);
    setSupabaseOrgsLoading(true);
    try {
      const res = await fetch('/api/installer/supabase/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao listar orgs (HTTP ${res.status})`);
      setSupabaseOrgs((data?.organizations || []) as SupabaseOrgOption[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar orgs';
      setSupabaseOrgsError(message);
    } finally {
      setSupabaseOrgsLoading(false);
    }
  };

  const orgNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of supabaseOrgs) map.set(o.slug, o.name);
    return map;
  }, [supabaseOrgs]);

  const supabaseActiveProjects = useMemo(() => {
    return supabaseOrgProjects.filter((p) => (p.status || '').toUpperCase().startsWith('ACTIVE'));
  }, [supabaseOrgProjects]);

  const supabaseActiveCount = supabaseActiveProjects.length;

  const supabaseOrgIsFreePlan = (supabaseSelectedOrgPlan || '').toLowerCase() === 'free';
  const supabaseOrgHasFreeSlot = !supabaseOrgIsFreePlan || supabaseActiveCount < 2;

  const supabaseGlobalFreeLimitHit = Boolean(supabasePreflight?.freeGlobalLimitHit);
  const supabaseGlobalActiveFreeCount = Number(supabasePreflight?.freeGlobalActiveCount || 0);
  const supabaseGlobalActiveFreeProjects = useMemo(() => {
    const orgs = supabasePreflight?.organizations || [];
    const all: SupabaseProjectOption[] = [];
    for (const o of orgs) {
      const plan = String((o as any)?.plan || '').toLowerCase();
      if (plan !== 'free') continue;
      const active = Array.isArray((o as any)?.activeProjects) ? (o as any).activeProjects : [];
      for (const p of active) all.push(p as SupabaseProjectOption);
    }
    return all;
  }, [supabasePreflight]);

  const supabaseCreateReady = Boolean(
    supabaseAccessToken.trim() &&
      (supabaseCreateOrgSlug.trim() || supabaseSelectedOrgSlug.trim()) &&
      supabaseCreateName.trim() &&
      supabaseCreateDbPass.length >= 12
  );

  useEffect(() => {
    // iPhone-like: se o usuário liberou 1 slot (pausando) e o formulário já está pronto, auto-cria e avança.
    if (!supabaseAutoCreateAfterFreeSlot) return;
    if (supabaseMode !== 'create') return;
    if (supabaseUiStep !== 'project') return;
    if (!supabaseOrgHasFreeSlot) return;
    if (!supabaseCreateReady) return;
    if (supabaseCreating) return;

    const handle = setTimeout(() => {
      void createSupabaseProject();
    }, 700);
    setSupabaseAutoCreateAfterFreeSlot(false);
    return () => clearTimeout(handle);
  }, [
    supabaseAutoCreateAfterFreeSlot,
    supabaseMode,
    supabaseUiStep,
    supabaseOrgHasFreeSlot,
    supabaseCreateReady,
    supabaseCreating,
  ]);

  const selectSupabaseProject = (ref: string) => {
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) return;

    // Prefer the org-scoped list (this is what we render in the UI).
    const selected =
      supabaseOrgProjects.find((p) => p.ref === cleanRef) ||
      supabaseProjects.find((p) => p.ref === cleanRef) ||
      null;

    setSupabaseSelectedProjectRef(cleanRef);
    setSupabaseUrl(selected?.supabaseUrl || `https://${cleanRef}.supabase.co`);
    setSupabaseProjectRefTouched(true);
    setSupabaseProjectRef(cleanRef);
    setSupabaseResolveError(null);
    setSupabaseUiStep('final');
  };

  useEffect(() => {
    // “100% mágico”: ao colar o PAT e escolher a org, carregamos os projetos da org automaticamente.
    if (supabaseUiStep === 'pat') return;
    const pat = supabaseAccessToken.trim();
    if (!pat) return;
    if (!supabaseSelectedOrgSlug) return;
    if (supabaseOrgProjectsLoading) return;

    const key = `${pat}::${supabaseSelectedOrgSlug}`;
    if (supabaseOrgProjectsLoadedKey === key) return;

    const handle = setTimeout(() => {
      void loadSupabaseOrganizationProjects(supabaseSelectedOrgSlug);
    }, 650);

    return () => clearTimeout(handle);
  }, [
    supabaseUiStep,
    supabaseAccessToken,
    supabaseSelectedOrgSlug,
    supabaseOrgProjectsLoading,
    supabaseOrgProjectsLoadedKey,
  ]);

  useEffect(() => {
    // Default nome do projeto (zero fricção): "nossocrm" (com sufixo se já existir).
    if (supabaseUiStep !== 'project') return;
    if (supabaseMode !== 'create') return;
    if (supabaseCreateName.trim()) return;
    const existingNames = supabaseOrgProjects.map((p) => p.name).filter(Boolean) as string[];
    setSupabaseCreateName(suggestSupabaseProjectName(existingNames));
  }, [supabaseUiStep, supabaseMode, supabaseCreateName, supabaseOrgProjects]);

  useEffect(() => {
    // Se temos orgs carregadas e ainda não escolhemos uma, aplica um default (primeira org).
    // Isso mantém o fluxo zero fricção para quem só tem 1 org, mas permite escolha quando há várias.
    if (supabaseOrgs.length === 0) return;
    if (supabaseSelectedOrgSlug) return;
    const first = supabaseOrgs[0]?.slug;
    if (!first) return;
    setSupabaseSelectedOrgSlug(first);
    setSupabaseCreateOrgSlug(first);
  }, [supabaseOrgs, supabaseSelectedOrgSlug]);

  useEffect(() => {
    // Se o aluno trocar o PAT, limpamos a seleção (evita selecionar projeto “de outro token”).
    setSupabaseSelectedProjectRef('');
    setSupabaseSelectedOrgSlug('');
    setSupabaseSelectedOrgPlan(null);
    setSupabaseProjectsLoadedForPat('');
    setSupabaseProjects([]);
    setSupabaseProjectsError(null);
    setSupabaseOrgs([]);
    setSupabaseOrgsError(null);
    setSupabaseOrgProjectsLoadedKey('');
    setSupabaseOrgProjects([]);
    setSupabaseOrgProjectsError(null);
    setSupabaseDeleteConfirmRef('');
    setSupabaseResolveError(null);
    setSupabaseResolvedOk(false);
    setSupabaseResolvedLabel(null);
    setSupabaseUrl('');
    setSupabaseProjectRef('');
    setSupabaseProjectRefTouched(false);
    setSupabaseUiStep('pat');
    setSupabasePatAutoAdvanced(false);
    setSupabasePreflight(null);
    setSupabasePreflightError(null);
  }, [supabaseAccessToken]);

  useEffect(() => {
    // Cinematic + zero friction:
    // - ao colar um PAT com cara de válido, tenta listar orgs automaticamente
    // - quando a chamada funciona, avança para "Destino" sem clique
    if (supabaseUiStep !== 'pat') return;
    if (supabasePatAutoAdvanced) return;

    const pat = supabaseAccessToken.trim();
    const looksLikePat = /^sbp_[A-Za-z0-9_-]{20,}$/.test(pat);
    if (!looksLikePat) return;
    if (supabaseOrgsLoading) return;
    if (supabaseOrgs.length > 0) return;
    if (supabaseOrgsError) return;

    const handle = setTimeout(() => {
      void (async () => {
        await loadSupabaseOrgs();
      })();
    }, 450);

    return () => clearTimeout(handle);
  }, [
    supabaseUiStep,
    supabasePatAutoAdvanced,
    supabaseAccessToken,
    supabaseOrgsLoading,
    supabaseOrgs.length,
    supabaseOrgsError,
  ]);

  useEffect(() => {
    // Quando orgs chegam e ainda estamos no PAT, faz auto-avanço.
    if (supabaseUiStep !== 'pat') return;
    if (supabasePatAutoAdvanced) return;
    if (supabaseOrgsLoading) return;
    if (supabaseOrgsError) return;
    if (supabaseOrgs.length === 0) return;

    // Pequena pausa “gravidade” antes de mudar de cena.
    const handle = setTimeout(() => {
      setSupabasePatAutoAdvanced(true);
      setSupabaseUiStep('project');
    }, 180);

    return () => clearTimeout(handle);
  }, [supabaseUiStep, supabasePatAutoAdvanced, supabaseOrgsLoading, supabaseOrgsError, supabaseOrgs.length]);

  useEffect(() => {
    // Preflight Apple-style: com PAT + orgs carregadas, já buscamos a lista global de projetos
    // para prever o limite do Free e evitar submeter o usuário a um erro inevitável.
    if (supabaseUiStep === 'pat') return;
    const pat = supabaseAccessToken.trim();
    if (!pat) return;
    if (supabaseOrgs.length === 0) return;
    if (supabasePreflight) return;
    void loadSupabasePreflight();
  }, [supabaseUiStep, supabaseAccessToken, supabaseOrgs.length, supabaseProjectsLoadedForPat]);

  useEffect(() => {
    // Apple-style: se existir uma org paga (ou única viável), auto-seleciona para criar (sem sobrescrever escolha explícita).
    if (supabaseUiStep !== 'project') return;
    if (supabaseMode !== 'create') return;
    if (supabaseSelectedOrgSlug) return;
    if (!supabasePreflight?.suggestedOrganizationSlug) return;
    const slug = supabasePreflight.suggestedOrganizationSlug;
    setSupabaseSelectedOrgSlug(slug);
    setSupabaseCreateOrgSlug(slug);
    setSupabaseOrgProjects([]);
    setSupabaseOrgProjectsLoadedKey('');
    void loadSupabaseOrganizationProjects(slug);
  }, [supabaseUiStep, supabaseMode, supabaseSelectedOrgSlug, supabasePreflight?.suggestedOrganizationSlug]);

  useEffect(() => {
    // Se só existe 1 org, auto-seleciona e já carrega os projetos (zero fricção).
    if (supabaseUiStep !== 'project') return;
    if (supabaseOrgs.length !== 1) return;
    if (supabaseSelectedOrgSlug) return;
    const only = supabaseOrgs[0]?.slug;
    if (!only) return;

    setSupabaseSelectedOrgSlug(only);
    setSupabaseCreateOrgSlug(only);
    setSupabaseSelectedOrgPlan(null);
    setSupabaseOrgProjects([]);
    setSupabaseOrgProjectsLoadedKey('');
    void loadSupabaseOrganizationProjects(only);
  }, [supabaseUiStep, supabaseOrgs, supabaseSelectedOrgSlug]);

  const createSupabaseProject = async () => {
    if (supabaseCreating) return;
    setSupabaseCreateError(null);
    setSupabaseCreating(true);
    try {
      const organizationSlug = (supabaseCreateOrgSlug.trim() || supabaseSelectedOrgSlug.trim()).trim();
      if (!organizationSlug) {
        throw new Error('Selecione uma organização para criar o projeto.');
      }
      // Apple-style: se o preflight já sabe que vai falhar no Free, não tentamos criar.
      const plan = (supabaseSelectedOrgPlan || '').toLowerCase();
      if (plan === 'free' && supabaseGlobalFreeLimitHit) {
        throw new Error(
          'Você já tem 2 projetos ativos no Free. Pause 1 projeto ativo (reversível) ou faça upgrade para criar um novo.'
        );
      }
      const res = await fetch('/api/installer/supabase/create-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          accessToken: supabaseAccessToken.trim(),
          organizationSlug,
          name: supabaseCreateName.trim(),
          dbPass: supabaseCreateDbPass,
          regionSmartGroup: supabaseCreateRegion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao criar projeto (HTTP ${res.status})`);

      // Auto-select the created project and move on to resolving keys/db.
      const ref = String(data?.projectRef || '');
      const url = String(data?.supabaseUrl || '');
      if (ref) {
        setSupabaseSelectedProjectRef(ref);
        setSupabaseProjectRef(ref);
      }
      if (url) setSupabaseUrl(url);

      // If this project was created through the wizard, we already know the DB password.
      // Prefer Transaction Pooler (6543) to avoid IPv6-only direct connections on IPv4 networks.
      if (ref && supabaseCreateDbPass.trim()) {
        setSupabaseDbUrl(
          buildSupabaseDbUrlFromPassword({
            projectRef: ref,
            dbPassword: supabaseCreateDbPass,
            mode: 'transaction_pooler',
          })
        );
      }

      // Immediately resolve keys/db.
      await resolveSupabase('manual');
      setSupabaseMode('existing');
      setSupabaseUiStep('final');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar projeto';
      setSupabaseCreateError(humanizeSupabaseCreateError(message));
    } finally {
      setSupabaseCreating(false);
    }
  };

  const loadEdgeFunctionsPreview = async () => {
    if (edgeFunctionsPreviewLoading) return;
    setEdgeFunctionsPreviewError(null);
    setEdgeFunctionsPreviewLoading(true);
    try {
      const res = await fetch('/api/installer/supabase/functions');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao listar Edge Functions (HTTP ${res.status})`);
      setEdgeFunctionsPreview((data?.functions || []) as Array<{ slug: string; verify_jwt: boolean }>);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar Edge Functions';
      setEdgeFunctionsPreviewError(message);
    } finally {
      setEdgeFunctionsPreviewLoading(false);
    }
  };

  const handleResetProject = () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_PROJECT);
    router.push('/install/start');
  };

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg relative overflow-hidden"
      onMouseMove={setParallaxFromEvent}
      onMouseLeave={clearParallax}
    >
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0%,rgba(2,6,23,0)_42%,rgba(2,6,23,0.88)_100%)] dark:opacity-100 opacity-0" />
        {/* Film grain (SVG noise, very subtle) */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E\")",
          }}
        />

        {/* Nebula blobs (parallax) */}
        <motion.div
          className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full blur-[120px] bg-cyan-500/18"
          style={{ x: mxSpring, y: mySpring }}
        />
        <motion.div
          className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] rounded-full blur-[100px] bg-teal-500/16"
          style={{ x: mxSpring, y: mySpring }}
        />
      </div>

      <div className="w-full max-w-2xl relative z-10 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-200 dark:border-primary-900/40 mb-4">
            <Shield className="w-7 h-7 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Instalação do CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Uma jornada guiada para preparar Vercel, Supabase e o primeiro acesso.
          </p>
        </div>

        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl p-8 shadow-xl backdrop-blur-sm space-y-6 relative">
          {/* subtle teal rim light */}
          <div className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 dark:opacity-100 bg-[radial-gradient(1200px_circle_at_20%_0%,rgba(34,211,238,0.18),transparent_52%),radial-gradient(900px_circle_at_100%_20%,rgba(45,212,191,0.12),transparent_50%)]" />
          {!meta && !metaError ? (
            <div className="flex items-center justify-center text-slate-600 dark:text-slate-300 py-8">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando instalador...
            </div>
          ) : null}
          {metaError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-900/20 p-3 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle size={16} className="mt-0.5" />
              <span>{metaError}</span>
            </div>
          ) : null}

          {meta && !meta.enabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
              <AlertCircle size={16} className="mt-0.5" />
              <span>Instalador desabilitado no servidor.</span>
            </div>
          ) : null}

          {meta?.enabled ? (
            <>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {wizardSteps.map((step, index) => {
                    const isActive = index === currentStep;
                    const isDone = index < currentStep;
                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-2 ${
                          isActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        <div
                          className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs ${
                            isDone
                              ? `bg-cyan-600 text-white border-cyan-600`
                              : isActive
                                ? `bg-cyan-600 text-white border-cyan-600`
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${TEAL.gradient} transition-all`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {chapter ? (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/30 p-4 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {chapter.title}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {chapter.subtitle}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {chapter.micro}
                  </div>
                </div>
              ) : null}

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`wizard-scene-${currentStep}`}
                  variants={sceneVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={sceneTransition}
                  className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4"
                >
                  {currentStep === 0 ? (
                    <div className="space-y-4">
                      {meta.requiresToken ? (
                        <div className="space-y-2">
                          <label className="text-sm text-slate-600 dark:text-slate-300">
                            Installer token
                          </label>
                          <input
                            value={installerToken}
                            onChange={(e) => setInstallerToken(e.target.value)}
                            className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                            placeholder="Token interno (opcional)"
                          />
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Projeto</span>
                          <span className="text-slate-900 dark:text-white font-medium">
                            {project?.name || '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">URL</span>
                          <span className="text-slate-700 dark:text-slate-200">
                            {project?.url || '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">PAT</span>
                          <span className="text-slate-700 dark:text-slate-200">
                            {maskValue(vercelToken)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleResetProject}
                          className={`inline-flex items-center gap-2 text-xs ${TEAL.solidText} hover:text-cyan-500`}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Trocar token/projeto
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {currentStep === 1 ? (
                    <>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Supabase: configuração guiada
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Vamos por partes: <b>PAT</b> → <b>projeto</b> → <b>auto-preenchimento</b>. Aqui aparece
                      apenas <b>uma etapa por vez</b> (e você pode voltar/editar a qualquer momento).
                    </p>
                  </div>

                  {/* Step 1: PAT (active) */}
                  {supabaseUiStep === 'pat' ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        1) Cole seu Supabase PAT
                      </div>
                      <input
                        type="password"
                        value={supabaseAccessToken}
                        onChange={(e) => setSupabaseAccessToken(e.target.value)}
                        className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                        placeholder="sbp_..."
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Use o <b>Access Token (PAT)</b> (geralmente começa com <code>sbp_</code>).{' '}
                        <b>Não</b> é o token de <i>Experimental API</i>. Gere em{' '}
                        <a
                          href="https://supabase.com/dashboard/account/tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          supabase.com/dashboard/account/tokens
                        </a>
                        .
                      </p>
                      <div className="flex items-center gap-2">
                      <button
                          type="button"
                          onClick={async () => {
                            setSupabaseUiStep('project');
                            await loadSupabaseOrgs();
                          }}
                          disabled={!supabaseAccessToken.trim()}
                        className={`px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${TEAL.solid}`}
                        >
                          Continuar
                        </button>
                        <button
                          type="button"
                          onClick={() => setSupabaseAdvanced(true)}
                          className="text-xs underline underline-offset-2 text-slate-600 dark:text-slate-300"
                        >
                          configurar manualmente (avançado)
                        </button>
                      </div>
                    </div>
                  ) : supabaseUiStep === 'final' ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/30 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          1) PAT ✅
                        </div>
                        <button
                          type="button"
                          onClick={() => setSupabaseUiStep('pat')}
                          className="text-xs underline underline-offset-2 text-slate-600 dark:text-slate-300"
                        >
                          editar
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {supabaseAccessToken.trim() ? (
                          <>
                            Token: <span className="font-mono">{maskValue(supabaseAccessToken)}</span>
                          </>
                        ) : (
                          'Token: —'
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Step 2: Choose / create project */}
                  {supabaseUiStep === 'project' ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          2) Escolha (ou crie) o projeto Supabase
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSupabaseUiStep('pat')}
                            className="px-2 py-1 rounded-full text-[11px] font-semibold border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-white/80 dark:hover:bg-white/10"
                            title="Editar PAT"
                          >
                            PAT ✅ <span className="font-mono">{maskValue(supabaseAccessToken)}</span>
                          </button>
                          {supabaseUrl.trim() ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSupabaseUrl('');
                                setSupabaseProjectRef('');
                                setSupabaseProjectRefTouched(false);
                                setSupabaseResolvedOk(false);
                                setSupabaseResolvedLabel(null);
                                setSupabaseResolveError(null);
                                setSupabaseUiStep('project');
                              }}
                              className="text-xs underline underline-offset-2 text-slate-600 dark:text-slate-300"
                            >
                              trocar projeto
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="supabase-mode"
                            checked={supabaseMode === 'existing'}
                            onChange={() => setSupabaseMode('existing')}
                            className="accent-primary-600"
                          />
                          Selecionar existente (já tenho um projeto)
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="supabase-mode"
                            checked={supabaseMode === 'create'}
                            onChange={() => setSupabaseMode('create')}
                            className="accent-primary-600"
                          />
                          Criar novo (recomendado)
                        </label>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Recomendado: <b>criar um projeto novo</b>. Se faltar slot no Free, você pode <b>pausar</b> ou <b>deletar</b> um antigo aqui.
                      </p>

                      {supabaseOrgs.length > 1 ? (
                        <div className="space-y-2">
                          <label className="text-sm text-slate-600 dark:text-slate-300">
                            Organização
                          </label>
                          <select
                            value={supabaseSelectedOrgSlug}
                            onChange={(e) => {
                              const slug = e.target.value;
                              setSupabaseSelectedOrgSlug(slug);
                              setSupabaseCreateOrgSlug(slug);
                              setSupabaseSelectedProjectRef('');
                              setSupabaseSelectedOrgPlan(null);
                              setSupabaseOrgProjects([]);
                              setSupabaseOrgProjectsLoadedKey('');
                              if (slug) {
                                void loadSupabaseOrganizationProjects(slug);
                              }
                            }}
                            className="w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          >
                            <option value="">Selecione…</option>
                            {supabaseOrgs.map((o) => (
                              <option key={o.slug} value={o.slug}>
                                {o.name} — {o.slug}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Você tem múltiplas orgs. Escolha a org certa para listar/criar projetos.
                          </p>
                        </div>
                      ) : null}

                      {supabaseMode === 'existing' ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!supabaseSelectedOrgSlug) return;
                                void loadSupabaseOrganizationProjects(supabaseSelectedOrgSlug);
                              }}
                              disabled={
                                supabaseOrgProjectsLoading || !supabaseAccessToken.trim() || !supabaseSelectedOrgSlug
                              }
                              className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              {supabaseOrgProjectsLoading ? 'Buscando…' : 'Buscar projetos desta org'}
                            </button>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {supabaseSelectedOrgSlug ? `(org: ${supabaseSelectedOrgSlug})` : '(selecione a org acima)'}
                            </span>
                          </div>

                          {supabaseOrgProjectsError ? (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
                              <AlertCircle size={16} className="mt-0.5" />
                              <span>{supabaseOrgProjectsError}</span>
                            </div>
                          ) : null}

                          {supabaseActiveCount >= 2 ? (
                            <div className="rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm space-y-2">
                              <div className="font-semibold">
                                Detectamos {supabaseActiveCount} projetos ativos.
                              </div>
                              <div className="text-xs">
                                {supabaseOrgIsFreePlan ? (
                                  <>
                                    Plano da org: <b>free</b>. O Supabase limita a <b>2 projetos ativos</b> nessa org.
                                  </>
                                ) : (
                                  <>
                                    Plano da org: <b>{supabaseSelectedOrgPlan || 'desconhecido'}</b>.
                                  </>
                                )}{' '}
                                Se você quiser criar um projeto novo, volte e escolha “Criar novo” — e, se faltar slot, pause/deleite um antigo.
                              </div>
                              <div className="pt-1 space-y-2">
                                <div className="max-h-64 overflow-auto space-y-2 pr-1">
                                {supabaseActiveProjects.map((p) => (
                                  <div
                                    key={p.ref}
                                    className="flex items-center justify-between gap-2 rounded-md border border-amber-200/60 dark:border-amber-500/20 bg-white/50 dark:bg-slate-900/30 p-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                        {p.name}
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                        {p.organizationSlug
                                          ? `${orgNameBySlug.get(p.organizationSlug) || p.organizationSlug} · `
                                          : ''}
                                        <span className="font-mono">{p.ref}</span>
                                        {p.status ? ` · ${p.status}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <a
                                        href={`https://supabase.com/dashboard/project/${encodeURIComponent(p.ref)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs underline underline-offset-2"
                                      >
                                        abrir
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => selectSupabaseProject(p.ref)}
                                        className={`px-2 py-1 rounded-md text-xs font-semibold text-white ${TEAL.solid}`}
                                      >
                                        Usar este projeto
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {!supabaseOrgProjectsLoading &&
                          supabaseSelectedOrgSlug &&
                          supabaseOrgProjectsLoadedKey === `${supabaseAccessToken.trim()}::${supabaseSelectedOrgSlug}` &&
                          supabaseOrgProjects.length === 0 ? (
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 p-3 text-sm text-slate-700 dark:text-slate-200 space-y-2">
                              <div className="font-semibold">Nenhum projeto encontrado nesse PAT.</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                A melhor opção é criar um projeto automaticamente.
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  setSupabaseMode('create');
                                  await loadSupabaseOrgs();
                                }}
                                className={`px-3 py-2 rounded-lg text-sm font-semibold text-white ${TEAL.solid}`}
                              >
                                Criar projeto automaticamente
                              </button>
                            </div>
                          ) : null}

                          {supabaseOrgProjects.length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                Projetos nesta org
                              </div>
                              <div className="max-h-56 overflow-auto space-y-2 pr-1">
                                {supabaseOrgProjects.map((p) => (
                                  <div
                                    key={p.ref}
                                    className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/30 p-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                        {p.name}
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                        <span className="font-mono">{p.ref}</span>
                                        {p.status ? ` · ${p.status}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <a
                                        href={`https://supabase.com/dashboard/project/${encodeURIComponent(p.ref)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs underline underline-offset-2"
                                      >
                                        abrir
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => selectSupabaseProject(p.ref)}
                                        className={`px-2 py-1 rounded-md text-xs font-semibold text-white ${TEAL.solid}`}
                                      >
                                        Usar este projeto
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Orgs já são carregadas automaticamente no passo PAT; aqui só mostramos erro se houver. */}
                          {supabaseOrgsError ? (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
                              <AlertCircle size={16} className="mt-0.5" />
                              <span>{supabaseOrgsError}</span>
                            </div>
                          ) : null}

                          {/* iPhone-style: se não há slot no Free, vira uma tela única de decisão (sem formulário). */}
                          {supabaseOrgIsFreePlan &&
                          (!supabaseOrgHasFreeSlot || supabaseGlobalFreeLimitHit) &&
                          (supabaseGlobalFreeLimitHit ? supabaseGlobalActiveFreeProjects.length > 0 : supabaseActiveProjects.length > 0) ? (
                            <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                                Sem espaço no Free (limite: 2 projetos ativos)
                              </div>
                              <div className="text-xs text-amber-800/80 dark:text-amber-200/80">
                                {supabaseGlobalFreeLimitHit ? (
                                  <>
                                    Seu PAT já tem <b>{supabaseGlobalActiveFreeCount}</b> projetos ativos no <b>Free</b> (limite: <b>2</b>). Para criar o{' '}
                                    <b>{supabaseCreateName || 'nossocrm'}</b>, libere <b>1 slot</b> pausando um projeto ativo.
                                  </>
                                ) : (
                                  <>
                                    Para criar o <b>{supabaseCreateName || 'nossocrm'}</b>, você precisa liberar <b>1 slot</b> nesta organização.
                                  </>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSupabaseFreeWallExpanded((v) => !v)}
                                  className={`px-3 py-2 rounded-xl text-sm font-semibold text-white ${TEAL.solid}`}
                                >
                                  Liberar 1 slot
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSupabaseMode('existing')}
                                  className="px-3 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-white/5"
                                >
                                  Usar existente
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Mantém o aluno na mesma tela, mas reforça que pode trocar org ali em cima.
                                    setSupabaseFreeWallExpanded(false);
                                  }}
                                  className="px-3 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-white/5"
                                >
                                  Trocar org
                                </button>
                              </div>

                              {supabaseFreeWallExpanded ? (
                                <div className="pt-1 space-y-2">
                                  <div className="text-xs text-amber-800/80 dark:text-amber-200/80">
                                    Recomendado: <b>Pausar</b> (reversível). Depois de pausar 1 projeto, vamos criar e continuar automaticamente.
                                  </div>
                                  <div className="max-h-56 overflow-auto space-y-2 pr-1">
                                    {(supabaseGlobalFreeLimitHit ? supabaseGlobalActiveFreeProjects : supabaseActiveProjects).map((p) => (
                                      <div
                                        key={p.ref}
                                        className="flex items-center justify-between gap-2 rounded-md border border-amber-200/60 dark:border-amber-500/20 bg-white/60 dark:bg-slate-900/30 p-2"
                                      >
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                            {p.name}
                                          </div>
                                          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                            {p.organizationSlug ? (
                                              <>
                                                {orgNameBySlug.get(p.organizationSlug) || p.organizationSlug} ·{' '}
                                              </>
                                            ) : null}
                                            <span className="font-mono">{p.ref}</span>
                                            {p.status ? ` · ${p.status}` : ''}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <a
                                            href={`https://supabase.com/dashboard/project/${encodeURIComponent(p.ref)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs underline underline-offset-2"
                                          >
                                            abrir
                                          </a>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSupabaseAutoCreateAfterFreeSlot(true);
                                              void pauseSupabaseProject(p.ref);
                                            }}
                                            disabled={!supabaseAccessToken.trim() || !!supabaseProjectActionRef || !supabaseCreateReady}
                                            className="px-2 py-1 rounded-md text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                                          >
                                            {supabaseProjectActionRef === p.ref ? '...' : 'Pausar'}
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <details className="pt-2">
                                    <summary className="cursor-pointer text-xs text-amber-800/90 dark:text-amber-200/90 underline underline-offset-2">
                                      Opções avançadas (destrutivas)
                                    </summary>
                                    <div className="mt-2 rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-white/60 dark:bg-slate-900/30 p-3 space-y-2">
                                      <div className="text-xs text-slate-700 dark:text-slate-300">
                                        <b>Deletar</b> é permanente. Para habilitar, digite o <code>ref</code> exato:
                                      </div>
                                      <input
                                        value={supabaseDeleteConfirmRef}
                                        onChange={(e) => setSupabaseDeleteConfirmRef(e.target.value)}
                                        className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                                        placeholder="cole o ref aqui"
                                      />
                                      <div className="max-h-48 overflow-auto space-y-2 pr-1">
                                        {supabaseActiveProjects.map((p) => (
                                          <div
                                            key={`del-${p.ref}`}
                                            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/30 p-2"
                                          >
                                            <div className="min-w-0">
                                              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                                {p.name}
                                              </div>
                                              <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                                <span className="font-mono">{p.ref}</span>
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => void deleteSupabaseProject(p.ref)}
                                              disabled={!supabaseAccessToken.trim() || !!supabaseProjectActionRef}
                                              className="px-2 py-1 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                                            >
                                              {supabaseProjectActionRef === p.ref ? '...' : 'Deletar'}
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </details>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Se está sem slot no Free (org ou global), escondemos o formulário (fica 1 CTA só). */}
                          {supabaseOrgIsFreePlan && (!supabaseOrgHasFreeSlot || supabaseGlobalFreeLimitHit) ? null : (
                            <>
                          <div className="space-y-2">
                            <label className="text-sm text-slate-600 dark:text-slate-300">
                              Nome do projeto
                            </label>
                            <input
                              value={supabaseCreateName}
                              onChange={(e) => setSupabaseCreateName(e.target.value)}
                              className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                              placeholder="nossocrm"
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <label className="text-sm text-slate-600 dark:text-slate-300">
                                Senha do banco (db_pass)
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSupabaseCreateDbPass(generateStrongSupabaseDbPass(20));
                                    setSupabaseDbPassCopied(false);
                                  }}
                                  className="text-xs underline underline-offset-2"
                                >
                                  gerar
                                </button>
                                <button
                                  type="button"
                                  disabled={!supabaseCreateDbPass.trim()}
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(supabaseCreateDbPass);
                                      setSupabaseDbPassCopied(true);
                                      setTimeout(() => setSupabaseDbPassCopied(false), 1200);
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                  className="text-xs underline underline-offset-2 disabled:opacity-50"
                                >
                                  {supabaseDbPassCopied ? 'copiado' : 'copiar'}
                                </button>
                              </div>
                            </div>
                            <input
                              type="password"
                              value={supabaseCreateDbPass}
                              onChange={(e) => {
                                setSupabaseCreateDbPass(e.target.value);
                                setSupabaseDbPassCopied(false);
                              }}
                              className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                              placeholder="mínimo 12 caracteres"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Guarde essa senha. Ela é sua credencial do Postgres.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm text-slate-600 dark:text-slate-300">
                              Região (smart group)
                            </label>
                            <select
                              value={supabaseCreateRegion}
                              onChange={(e) =>
                                setSupabaseCreateRegion(e.target.value as 'americas' | 'emea' | 'apac')
                              }
                              className="w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            >
                              <option value="americas">Americas</option>
                              <option value="emea">EMEA</option>
                              <option value="apac">APAC</option>
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={createSupabaseProject}
                            disabled={
                              supabaseCreating ||
                              !supabaseAccessToken.trim() ||
                              !(supabaseCreateOrgSlug.trim() || supabaseSelectedOrgSlug.trim()) ||
                              !supabaseCreateName.trim() ||
                              supabaseCreateDbPass.length < 12 ||
                              (supabaseOrgIsFreePlan && !supabaseOrgHasFreeSlot)
                            }
                            className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-400/30 active:scale-[0.98] bg-cyan-600 hover:bg-cyan-500"
                          >
                            {supabaseCreating ? (
                              <>
                                <Loader2 className="animate-spin h-5 w-5 mr-2" />
                                Criando…
                              </>
                            ) : (
                              'Criar projeto e continuar'
                            )}
                          </button>

                          {supabaseCreateError ? (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
                              <AlertCircle size={16} className="mt-0.5" />
                              <span>{humanizeSupabaseCreateError(supabaseCreateError)}</span>
                            </div>
                          ) : null}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                    </>
                  ) : null}
                {/* (Scene ends below, right before the footer actions) */}

                  {/* Step 3: final + toggles */}
                  {supabaseUiStep === 'final' && supabaseUrl.trim() ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white/70 dark:bg-slate-900/30 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          2) Projeto ✅
                        </div>
                        <button
                          type="button"
                          onClick={() => setSupabaseUiStep('project')}
                          className="text-xs underline underline-offset-2 text-slate-600 dark:text-slate-300"
                        >
                          editar
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Org:{' '}
                        <span className="font-mono">
                          {supabaseSelectedOrgSlug || supabaseCreateOrgSlug || '—'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Projeto:{' '}
                        <span className="font-mono">
                          {supabaseProjectRef || inferProjectRefFromSupabaseUrl(supabaseUrl.trim()) || '—'}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {supabaseUiStep === 'final' && supabaseUrl.trim() ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        3) Pronto — agora é só deixar o sistema fazer o resto
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Projeto: <span className="font-mono">{supabaseProjectRef || inferProjectRefFromSupabaseUrl(supabaseUrl.trim()) || '—'}</span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        URL: <span className="font-mono">{supabaseUrl.trim()}</span>
                      </div>

                      <label className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-medium">Deploy Edge Functions</span>
                        <input
                          type="checkbox"
                          checked={supabaseDeployEdgeFunctions}
                          onChange={(e) => setSupabaseDeployEdgeFunctions(e.target.checked)}
                          className="accent-primary-600"
                        />
                      </label>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Quando ligado, o instalador vai setar secrets e fazer deploy das Edge Functions do repositório.
                      </p>

                      <div className="pt-1 space-y-2">
                        <button
                          type="button"
                          onClick={loadEdgeFunctionsPreview}
                          disabled={edgeFunctionsPreviewLoading}
                          className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {edgeFunctionsPreviewLoading ? 'Verificando…' : 'Ver quais functions serão deployadas'}
                        </button>

                        {edgeFunctionsPreviewError ? (
                          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <span>{edgeFunctionsPreviewError}</span>
                          </div>
                        ) : null}

                        {edgeFunctionsPreview.length > 0 ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                            {edgeFunctionsPreview.map((f) => (
                              <div key={f.slug} className="flex items-center justify-between gap-3">
                                <span className="font-mono">{f.slug}</span>
                                <span className="font-mono">verify_jwt={String(f.verify_jwt)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {supabaseResolving ? (
                        <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 p-3 text-slate-700 dark:text-slate-200 text-sm">
                          <Loader2 size={16} className="mt-0.5 animate-spin" />
                          <span>Resolvendo keys + DB automaticamente…</span>
                        </div>
                      ) : supabaseResolvedOk ? (
                        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-emerald-700 dark:text-emerald-300 text-sm">
                          <CheckCircle2 size={16} className="mt-0.5" />
                          <span>{supabaseResolvedLabel || 'Chaves e DB resolvidos automaticamente.'}</span>
                        </div>
                      ) : supabaseResolveError ? (
                        <div className="space-y-2">
                          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-700 dark:text-amber-300 text-sm">
                            <AlertCircle size={16} className="mt-0.5" />
                            <span>{supabaseResolveError}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void resolveSupabase('manual')}
                            disabled={
                              supabaseResolving ||
                              !supabaseAccessToken.trim() ||
                              (!supabaseUrl.trim() && !supabaseProjectRef.trim())
                            }
                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50"
                          >
                            Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void resolveSupabase('manual')}
                          disabled={
                            supabaseResolving ||
                            !supabaseAccessToken.trim() ||
                            (!supabaseUrl.trim() && !supabaseProjectRef.trim())
                          }
                          className={`px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${TEAL.solid}`}
                        >
                          Rodar auto-preenchimento agora
                        </button>
                      )}
                    </div>
                  ) : null}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setSupabaseAdvanced((v) => !v)}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500 underline underline-offset-2"
                    >
                      {supabaseAdvanced ? 'Ocultar avançado' : 'Mostrar avançado'}
                    </button>
                  </div>

                  {supabaseAdvanced ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          Project URL
                        </label>
                        <input
                          value={supabaseUrl}
                          onChange={(e) => setSupabaseUrl(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          placeholder="https://xxxx.supabase.co"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          Project ref (opcional)
                        </label>
                        <input
                          value={supabaseProjectRef}
                          onChange={(e) => {
                            setSupabaseProjectRefTouched(true);
                            setSupabaseProjectRef(e.target.value);
                          }}
                          className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          placeholder="ex: abcdefghijklmnopqrst"
                        />
                        {!supabaseProjectRefTouched && supabaseUrl.trim() ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Inferido do URL:{' '}
                            <span className="font-mono">
                              {inferProjectRefFromSupabaseUrl(supabaseUrl.trim()) || '—'}
                            </span>
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          Anon/publishable key
                        </label>
                        <input
                          type="password"
                          value={supabaseAnonKey}
                          onChange={(e) => setSupabaseAnonKey(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          placeholder="(auto)"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          Secret/service role key
                        </label>
                        <input
                          type="password"
                          value={supabaseServiceKey}
                          onChange={(e) => setSupabaseServiceKey(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          placeholder="(auto)"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">
                          DB connection string
                        </label>
                        <input
                          type="password"
                          value={supabaseDbUrl}
                          onChange={(e) => setSupabaseDbUrl(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                          placeholder="(auto)"
                        />
                      </div>
                    </div>
                  ) : null}
              {/* The rest of steps (Admin/Review) are rendered inside the wizard-scene block above */}

              {currentStep === 2 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Nome da empresa
                    </label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                      placeholder="Acme Corp"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Email do admin
                    </label>
                    <input
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                      placeholder="admin@empresa.com"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        Senha
                      </label>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                        placeholder="Min 6 caracteres"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        Confirmar senha
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring}`}
                        placeholder="Repita a senha"
                      />
                    </div>
                  </div>

                  {!passwordValid && adminPassword.length > 0 ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Senha deve ter no minimo 6 caracteres.
                    </p>
                  ) : null}
                  {adminPassword.length > 0 && !passwordsMatch ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Senhas nao conferem.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {currentStep === 3 ? (
                <div className="border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Vercel
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Projeto: {project?.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        URL: {project?.url}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        PAT: {maskValue(vercelToken)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Envs: {selectedTargets.join(', ')}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Supabase
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        URL: {supabaseUrl}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Anon: {maskValue(supabaseAnonKey)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Service: {maskValue(supabaseServiceKey)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        DB: {maskValue(supabaseDbUrl, 12, 10)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Edge Functions:{' '}
                        {supabaseDeployEdgeFunctions ? 'deploy via Management API' : 'skip'}
                      </div>
                      {supabaseDeployEdgeFunctions ? (
                        <>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Project ref: {supabaseProjectRef ? supabaseProjectRef : '(inferir do URL)'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            PAT: {maskValue(supabaseAccessToken)}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Admin
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Empresa: {companyName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Email: {adminEmail}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50">
                    Esse passo vai configurar envs na Vercel, aplicar o schema no Supabase,
                    criar o admin inicial e disparar um redeploy.
                  </div>

                  <button
                    type="button"
                    onClick={runInstaller}
                    disabled={!canInstall || installing}
                    className={`w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 focus:ring-offset-2 ${TEAL.ring} active:scale-[0.98] bg-cyan-600 hover:bg-cyan-500`}
                  >
                    {installing ? (
                      <>
                        <Loader2 className="animate-spin h-5 w-5 mr-2" />
                        Instalando...
                      </>
                    ) : (
                      'Instalar agora'
                    )}
                  </button>

                  {runError ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-900/20 p-3 text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle size={16} className="mt-0.5" />
                      <div className="space-y-1">
                        <span className="block">{runError}</span>
                        {shouldShowTokenHelp(runError) ? (
                          <span className="block text-xs text-red-500 dark:text-red-300">
                            Gere um novo token em{' '}
                            <a
                              href="https://vercel.com/account/tokens"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              vercel.com/account/tokens
                            </a>
                            .
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {result ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Resultado
                      </h3>
                      <div className="space-y-1">
                        {result.steps?.map((step) => (
                          <div key={step.id} className="flex items-center gap-2 text-sm">
                            <CheckCircle2
                              size={14}
                              className={statusColor(step.status)}
                            />
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {step.id}
                            </span>
                            <span className={statusColor(step.status)}>
                              {step.status}
                            </span>
                            {step.message ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {step.message}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {result.ok ? (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Instalacao concluida. Aguarde o redeploy e faca login com o admin.
                        </p>
                      ) : null}
                      {redeployWarning ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Redeploy falhou via API. Dispare um redeploy manual no Vercel.
                        </p>
                      ) : null}
                      {result.ok ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          O instalador sera desativado automaticamente apos o deploy.
                        </p>
                      ) : null}

                      {result.functions && result.functions.length > 0 ? (
                        <div className="pt-2 space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Edge Functions
                          </h4>
                          <div className="space-y-1">
                            {result.functions.map((fn) => (
                              <div key={fn.slug} className="flex items-center gap-2 text-sm">
                                <CheckCircle2
                                  size={14}
                                  className={fn.ok ? statusColor('ok') : statusColor('error')}
                                />
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {fn.slug}
                                </span>
                                <span className={fn.ok ? statusColor('ok') : statusColor('error')}>
                                  {fn.ok ? 'ok' : 'error'}
                                </span>
                                {!fn.ok ? (
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {fn.error}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

                </motion.div>
              </AnimatePresence>

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={currentStep === 0 || installing}
                  className={`px-3 py-2 rounded-lg text-sm border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 ${TEAL.ring} active:scale-[0.99]`}
                >
                  Voltar
                </button>
                {currentStep < wizardSteps.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!stepReady[currentStep]}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 focus:ring-offset-2 ${TEAL.ring} active:scale-[0.98] bg-cyan-600 hover:bg-cyan-500`}
                  >
                    Avancar
                  </button>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {canInstall ? 'Pronto para instalar.' : 'Revise os dados antes de instalar.'}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Cinematic install overlay (C) */}
      <AnimatePresence>
        {showInstallOverlay ? (
          <motion.div
            key="install-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
          >
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, y: 14, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(8px)' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-[min(880px,92vw)] rounded-2xl border border-white/10 bg-slate-950/70 shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(900px_circle_at_20%_0%,rgba(34,211,238,0.18),transparent_55%),radial-gradient(700px_circle_at_100%_10%,rgba(45,212,191,0.12),transparent_55%)]" />

              <div className="relative p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Piloto automático
                    </div>
                    <div className="text-xl font-bold text-white tracking-tight">
                      Preparando seu novo mundo
                    </div>
                    <div className="text-sm text-slate-300">
                      {installing
                        ? 'Executando instalação… você pode só observar.'
                        : runError
                          ? 'Encontramos um problema. Você pode corrigir e tentar de novo.'
                          : result?.ok
                            ? 'Tudo pronto. Agora começa.'
                            : 'Instalação finalizada com avisos.'}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!cineCanClose && installing}
                    onClick={() => {
                      if (!cineCanClose && installing) return;
                      setShowInstallOverlay(false);
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-white/10 text-slate-200 hover:bg-white/5 transition disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    Fechar
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Timeline
                    </div>
                    <div className="mt-3 space-y-2">
                      {expectedInstallTimeline.map((s, idx) => {
                        const real = result?.steps?.find((st) => st.id === s.id);
                        const isRunning = installing && !result && idx === cineTimelineIndex;
                        const isAhead = installing && !result && idx < cineTimelineIndex;
                        const status: 'queued' | 'running' | 'ok' | 'warning' | 'error' =
                          real?.status === 'ok' || real?.status === 'warning' || real?.status === 'error'
                            ? (real.status as 'ok' | 'warning' | 'error')
                            : isRunning
                              ? 'running'
                              : isAhead
                                ? 'queued'
                                : 'queued';

                        const icon =
                          status === 'running' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
                          ) : (
                            <CheckCircle2
                              size={16}
                              className={
                                status === 'ok'
                                  ? 'text-emerald-400'
                                  : status === 'warning'
                                    ? 'text-amber-400'
                                    : status === 'error'
                                      ? 'text-red-400'
                                      : 'text-slate-500'
                              }
                            />
                          );

                        return (
                          <div key={s.id} className="flex items-center gap-3">
                            <div className="shrink-0">{icon}</div>
                            <div className="min-w-0">
                              <div className="text-sm text-slate-100 truncate">{s.label}</div>
                              <div className="text-xs text-slate-400">
                                {real?.status
                                  ? real.status
                                  : status === 'running'
                                    ? 'em andamento'
                                    : 'na fila'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Telemetria
                    </div>
                    <div className="text-sm text-slate-200">
                      {typeof cineStartedAtMs === 'number' ? (
                        <span>
                          Tempo: <span className="text-slate-300">
                            {Math.max(0, Math.round((Date.now() - cineStartedAtMs) / 1000))}s
                          </span>
                        </span>
                      ) : (
                        <span>Tempo: —</span>
                      )}
                    </div>
                    {runError ? (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                        {runError}
                      </div>
                    ) : null}
                    {result?.functions && result.functions.length > 0 ? (
                      <div className="pt-1 space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Edge Functions
                        </div>
                        <div className="space-y-1">
                          {result.functions.map((fn) => (
                            <div key={fn.slug} className="flex items-center gap-2 text-sm">
                              <CheckCircle2
                                size={14}
                                className={fn.ok ? 'text-emerald-400' : 'text-red-400'}
                              />
                              <span className="text-slate-200">{fn.slug}</span>
                              <span className="text-xs text-slate-400">
                                {fn.ok ? 'ok' : 'erro'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={installing}
                        onClick={() => setShowInstallOverlay(false)}
                        className={`w-full py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 ${TEAL.ring} bg-cyan-600 hover:bg-cyan-500`}
                      >
                        {installing ? 'Em andamento…' : 'Continuar'}
                      </button>
                      <div className="mt-2 text-[11px] text-slate-400">
                        {installing
                          ? 'Não feche a aba — estamos configurando tudo para você.'
                          : 'Você pode fechar este painel e seguir no wizard.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
