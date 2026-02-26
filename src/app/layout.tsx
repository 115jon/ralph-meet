import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const font = Figtree({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Ralph Meet — Real-Time Video Conferencing",
  description:
    "Real-time video, audio & screen sharing powered by Cloudflare Realtime SFU",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: 'var(--rm-accent)',
          colorDanger: 'var(--destructive)',
          colorSuccess: 'var(--rm-status-online)',
          colorWarning: 'var(--rm-status-idle)',
          colorBackground: 'var(--rm-bg-primary)',
          colorInputBackground: 'var(--rm-bg-elevated)',
          colorInputText: 'var(--rm-text-primary)',
          colorText: 'var(--rm-text-primary)',
          colorTextSecondary: 'var(--rm-text-muted)',
          colorNeutral: 'var(--rm-text-primary)',
          borderRadius: '0.625rem',
          fontFamily: 'inherit',
        },
        elements: {
          card: {
            backgroundColor: 'var(--rm-bg-surface)',
            border: '1px solid var(--rm-border)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.2)',
          },
          headerTitle: {
            color: 'var(--rm-text-primary)',
          },
          headerSubtitle: {
            color: 'var(--rm-text-muted)',
          },
          socialButtonsBlockButton: {
            backgroundColor: 'var(--rm-bg-floating)',
            border: '1px solid var(--rm-border)',
            color: 'var(--rm-text-secondary)',
            '&:hover': {
              backgroundColor: 'var(--rm-bg-hover)',
              borderColor: 'var(--rm-border)',
            },
          },
          formButtonPrimary: {
            background: 'var(--rm-accent)',
            border: 'none',
            fontWeight: '600',
            color: '#ffffff',
            '&:hover': {
              background: 'var(--rm-accent-hover)',
            },
          },
          formFieldInput: {
            backgroundColor: 'var(--rm-bg-floating)',
            border: '1px solid var(--rm-border)',
            color: 'var(--rm-text-primary)',
            '&:focus': {
              borderColor: 'var(--rm-accent)',
              boxShadow: 'none',
            },
          },
          formFieldLabel: {
            color: 'var(--rm-text-muted)',
          },
          footerActionLink: {
            color: 'var(--rm-accent)',
            '&:hover': {
              color: 'var(--rm-accent-hover)',
            },
          },
          dividerLine: {
            backgroundColor: 'var(--rm-border)',
          },
          dividerText: {
            color: 'var(--rm-text-muted)',
          },
          footer: {
            '& + div': {
              background: 'transparent',
            },
          },
          identityPreview: {
            backgroundColor: 'var(--rm-bg-hover)',
            borderColor: 'var(--rm-border)',
          },
          identityPreviewText: {
            color: 'var(--rm-text-secondary)',
          },
          identityPreviewEditButton: {
            color: 'var(--rm-accent)',
          },
          otpCodeFieldInput: {
            backgroundColor: 'var(--rm-bg-floating)',
            border: '1px solid var(--rm-border)',
            color: 'var(--rm-text-primary)',
          },
          formResendCodeLink: {
            color: 'var(--rm-accent)',
          },
          alert: {
            backgroundColor: 'var(--rm-bg-hover)',
            borderColor: 'var(--rm-border)',
          },
          alertText: {
            color: 'var(--rm-text-secondary)',
          },
          userButtonPopoverCard: {
            backgroundColor: 'var(--rm-bg-surface)',
            border: '1px solid var(--rm-border)',
          },
          userButtonPopoverActionButton: {
            color: 'var(--rm-text-secondary)',
            '&:hover': {
              backgroundColor: 'var(--rm-bg-hover)',
            },
          },
          userButtonPopoverFooter: {
            borderTopColor: 'var(--rm-border)',
          },
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body className={`bg-[var(--rm-bg-primary)] antialiased font-sans ${font.variable}`}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider delayDuration={200}>
              {children}
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
