'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Loader2, Shield } from 'lucide-react';
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

type VercelTeam = {
  id: string;
  name: string;
  slug?: string;
};

type VercelProject = {
  id: string;
  name: string;
  accountId?: string;
  alias?: { domain: string }[];
  targets?: { production?: { alias?: string[] } };
};

const STORAGE_TOKEN = 'crm_install_token';
const STORAGE_PROJECT = 'crm_install_project';
const STORAGE_INSTALLER_TOKEN = 'crm_install_installer_token';

const shouldShowTokenHelp = (message: string) => {
  const text = message.toLowerCase();
  return text.includes('vercel') && text.includes('token');
};

const maskValue = (value: string, start = 4, end = 4) => {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= start + end) return `${'*'.repeat(Math.max(0, v.length - 2))}${v.slice(-2)}`;
  return `${v.slice(0, start)}${'•'.repeat(Math.max(3, v.length - start - end))}${v.slice(-end)}`;
};

/**
 * Componente React `InstallStartPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function InstallStartPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<InstallerMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [installerToken, setInstallerToken] = useState('');
  const [token, setToken] = useState('');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'confirm' | 'success'>(
    'input'
  );
  const [isLoading, setIsLoading] = useState(false);

  const [teams, setTeams] = useState<VercelTeam[]>([]);
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  // “100% mágico”: só mostramos seleção manual se a detecção automática falhar.
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    ease: [0.22, 1, 0.36, 1],
    duration: 0.32,
  } as const;

  const chapter = useMemo(() => {
    // Abertura (antes do wizard): Vercel é o “sinal” que aponta a nave certa.
    return {
      title: 'Prólogo — Sinal',
      subtitle: 'Encontrando sua nave na Vercel.',
      micro: 'Uma coordenada de cada vez.',
    };
  }, []);

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

    if (savedInstallerToken) {
      setInstallerToken(savedInstallerToken);
    }

    if (savedToken && savedProject) {
      try {
        const parsedProject = JSON.parse(savedProject) as ProjectInfo;
        setToken(savedToken);
        setProject(parsedProject);
        setStep('confirm');
      } catch {
        localStorage.removeItem(STORAGE_PROJECT);
      }
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!token.trim()) {
      setError('Token da Vercel é obrigatório');
      return;
    }

    if (meta?.requiresToken && !installerToken.trim()) {
      setError('Installer token obrigatório');
      return;
    }

    setIsLoading(true);
    setStep('validating');

    try {
      if (showAdvanced && selectedProjectId) {
        const p = projects.find((x) => x.id === selectedProjectId);
        if (!p) throw new Error('Selecione um projeto válido.');
        const productionAliases = p.targets?.production?.alias || [];
        const projectAliases = p.alias?.map((a) => a.domain) || [];
        const allAliases = [...productionAliases, ...projectAliases];
        const primaryUrl =
          allAliases.find((alias) => alias.endsWith('.vercel.app')) ||
          allAliases[0] ||
          `${p.name}.vercel.app`;

        const teamId = selectedTeamId || (p.accountId && p.accountId !== '' ? p.accountId : undefined);

        setProject({
          id: p.id,
          name: p.name,
          teamId,
          url: primaryUrl,
        });
        setStep('confirm');
        return;
      }

      const response = await fetch('/api/installer/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          installerToken: installerToken.trim() || undefined,
          domain: typeof window !== 'undefined' ? window.location.hostname : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Erro ao validar token');
      }

      setProject(data.project);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao validar token');
      setShowAdvanced(true);
      setStep('input');
    } finally {
      setIsLoading(false);
    }
  };

  const lookupVercel = async () => {
    if (!token.trim()) {
      setLookupError('Token da Vercel é obrigatório.');
      return;
    }
    if (meta?.requiresToken && !installerToken.trim()) {
      setLookupError('Installer token obrigatório.');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await fetch('/api/installer/vercel/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installerToken: installerToken.trim() || undefined,
          token: token.trim(),
          teamId: selectedTeamId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Falha ao buscar dados da Vercel (HTTP ${res.status})`);

      setTeams((data?.teams || []) as VercelTeam[]);
      setProjects((data?.projects || []) as VercelProject[]);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Falha ao buscar dados da Vercel');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!project) return;

    localStorage.setItem(STORAGE_TOKEN, token.trim());
    localStorage.setItem(STORAGE_PROJECT, JSON.stringify(project));

    if (installerToken.trim()) {
      localStorage.setItem(STORAGE_INSTALLER_TOKEN, installerToken.trim());
    }

    setStep('success');
    setTimeout(() => {
      router.push('/install/wizard');
    }, 800);
  };

  const handleReset = () => {
    setProject(null);
    setStep('input');
    setError('');
  };

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

      <div className="max-w-lg w-full relative z-10 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-200 dark:border-cyan-900/30 mb-4">
            <Shield className="w-7 h-7 text-cyan-600 dark:text-cyan-300" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Instalação do CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Precisamos do seu token da Vercel para detectar o projeto certo.
          </p>
        </div>

        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8 backdrop-blur-sm relative overflow-hidden">
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
              {chapter ? (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/30 p-4 space-y-1 relative z-10 mb-5">
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
                  key={`start-scene-${step}`}
                  variants={sceneVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={sceneTransition}
                  className="relative z-10"
                >
                  {step === 'success' ? (
                <div className="text-center py-10">
                      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-cyan-500/10 mb-4 border border-cyan-200 dark:border-cyan-900/30">
                        <CheckCircle2 className="w-7 h-7 text-cyan-600 dark:text-cyan-300" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                        Rota confirmada
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Entrando no wizard…
                  </p>
                </div>
              ) : step === 'confirm' && project ? (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                      Projeto encontrado
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                          Confirme se este é o destino correto.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Nome</span>
                      <span className="text-slate-900 dark:text-white font-medium">
                        {project.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">URL</span>
                      <a
                        href={`https://${project.url || `${project.name}.vercel.app`}`}
                        target="_blank"
                        rel="noopener noreferrer"
                            className={`${TEAL.solidText} hover:underline flex items-center gap-1`}
                      >
                        {project.url || `${project.name}.vercel.app`}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Domínio atual</span>
                      <span className="text-slate-900 dark:text-white font-mono">
                        {typeof window !== 'undefined' ? window.location.hostname : ''}
                      </span>
                    </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">PAT</span>
                          <span className="text-slate-900 dark:text-white font-mono">
                            {maskValue(token)}
                          </span>
                        </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleReset}
                          disabled={isLoading}
                          className={`flex-1 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 font-medium py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${TEAL.ring} active:scale-[0.99] disabled:opacity-50`}
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                          disabled={isLoading}
                          className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-400/30 active:scale-[0.98] disabled:opacity-50"
                    >
                          Confirmar e decolar
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                  ) : step === 'validating' ? (
                    <div className="py-10 text-center space-y-3">
                      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-200 dark:border-cyan-900/30">
                        <Loader2 className="w-7 h-7 animate-spin text-cyan-600 dark:text-cyan-300" />
                      </div>
                      <div className="text-lg font-semibold text-slate-900 dark:text-white">
                        Calibrando sinais…
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">
                        Estamos detectando o projeto deste deploy.
                      </div>
                    </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                      Token da Vercel
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Vamos usar seu token para configurar as envs automaticamente.
                    </p>
                  </div>

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
                        disabled={isLoading}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      Vercel PAT
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className={`w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${TEAL.ring} font-mono text-sm`}
                      placeholder="pat_xxx"
                      disabled={isLoading}
                    />
                  </div>

                  {showAdvanced ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Modo avançado (fallback)
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(false)}
                          className="text-xs underline underline-offset-2 text-slate-600 dark:text-slate-300"
                          disabled={isLoading}
                        >
                          esconder
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        A detecção automática do projeto falhou. Use este modo para selecionar manualmente.
                      </p>

                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={lookupVercel}
                            disabled={lookupLoading || isLoading || !token.trim()}
                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {lookupLoading ? 'Buscando…' : 'Buscar times/projetos'}
                          </button>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            (usa o PAT)
                          </span>
                        </div>

                        {lookupError ? (
                          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <span>{lookupError}</span>
                          </div>
                        ) : null}

                        {teams.length > 0 ? (
                          <div className="space-y-2">
                            <label className="text-sm text-slate-600 dark:text-slate-300">
                              Team (opcional)
                            </label>
                            <select
                              value={selectedTeamId}
                              onChange={(e) => {
                                setSelectedTeamId(e.target.value);
                                setSelectedProjectId('');
                              }}
                              className="w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            >
                              <option value="">Meu usuário (sem team)</option>
                              {teams.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} {t.slug ? `— ${t.slug}` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={lookupVercel}
                              disabled={lookupLoading || isLoading || !token.trim()}
                              className={`text-xs underline underline-offset-2 ${TEAL.solidText}`}
                            >
                              Atualizar projetos deste team
                            </button>
                          </div>
                        ) : null}

                        {projects.length > 0 ? (
                          <div className="space-y-2">
                            <label className="text-sm text-slate-600 dark:text-slate-300">
                              Projeto
                            </label>
                            <select
                              value={selectedProjectId}
                              onChange={(e) => setSelectedProjectId(e.target.value)}
                              className="w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            >
                              <option value="">Selecione…</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — {p.id}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Dica: se você não achar, confirme se escolheu o Team certo.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-600 dark:text-slate-300">
                    <p className="font-medium mb-2 text-slate-700 dark:text-slate-200">
                      Como obter o token:
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                      Site oficial da Vercel:{' '}
                      <a
                        href="https://vercel.com/account/tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${TEAL.solidText} hover:underline`}
                      >
                        vercel.com/account/tokens
                      </a>
                    </p>
                    <ol className="space-y-2 text-slate-500 dark:text-slate-400">
                      <li>1) Acesse vercel.com/account/tokens</li>
                      <li>2) Clique em Create Token</li>
                      <li>3) Scope: Full Account</li>
                      <li>4) Copie o token</li>
                      <li>5) Cole aqui e avance</li>
                    </ol>
                  </div>

                  {error ? (
                    <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <div className="space-y-1">
                        <span className="block">{error}</span>
                        {shouldShowTokenHelp(error) ? (
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

                  <button
                    type="submit"
                    disabled={isLoading || !token.trim()}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-400/30 active:scale-[0.98]"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        Continuar
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
                </motion.div>
              </AnimatePresence>
            </>
          ) : null}
        </div>

        <p className="text-center text-slate-400 dark:text-slate-500 text-xs mt-6">
          Seu token é usado apenas para configurar as envs do projeto.
        </p>
      </div>
    </div>
  );
}
