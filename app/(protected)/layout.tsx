'use client'

import { usePathname } from 'next/navigation'

import { QueryProvider } from '@/lib/query'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { AuthProvider } from '@/context/AuthContext'
import { CRMProvider } from '@/context/CRMContext'
import { AIProvider } from '@/context/AIContext'
import Layout from '@/components/Layout'

export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const shouldUseAppShell = pathname !== '/setup'

    return (
        <QueryProvider>
            <ToastProvider>
                <ThemeProvider>
                    <AuthProvider>
                        <CRMProvider>
                            <AIProvider>
                                {shouldUseAppShell ? <Layout>{children}</Layout> : children}
                            </AIProvider>
                        </CRMProvider>
                    </AuthProvider>
                </ThemeProvider>
            </ToastProvider>
        </QueryProvider>
    )
}

