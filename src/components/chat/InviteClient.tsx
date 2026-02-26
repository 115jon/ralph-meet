'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function InviteClient() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'joining' | 'success' | 'error'>('loading');
  const [serverName, setServerName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!code) return;
    joinServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const joinServer = async () => {
    setStatus('joining');
    try {
      const res = await fetch(`/api/invites/${code}/join`, { method: 'POST' });
      const data = await res.json() as {
        joined?: boolean;
        already_member?: boolean;
        server?: { name: string; id: string };
        error?: string;
      };

      if (res.ok && data.server) {
        setServerName(data.server.name);
        setStatus('success');
        // Redirect to chat after a brief delay
        setTimeout(() => router.push('/chat'), 2000);
      } else {
        setErrorMsg(data.error ?? 'Failed to join');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#1e1f22',
      color: '#f2f3f5',
      fontFamily: 'var(--font-sans, system-ui)',
    }}>
      <div style={{
        background: '#2b2d31',
        borderRadius: 16,
        padding: '40px 48px',
        textAlign: 'center',
        maxWidth: 400,
        width: '90%',
      }}>
        {status === 'loading' || status === 'joining' ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Accepting Invite...</h1>
            <p style={{ color: '#949ba4' }}>Joining server, please wait.</p>
          </>
        ) : status === 'success' ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>
              Joined {serverName}!
            </h1>
            <p style={{ color: '#949ba4' }}>Redirecting to chat...</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😞</div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>
              Invite Invalid
            </h1>
            <p style={{ color: '#949ba4', marginBottom: 20 }}>{errorMsg}</p>
            <button
              onClick={() => router.push('/chat')}
              style={{
                padding: '10px 24px',
                background: '#5865f2',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go to Chat
            </button>
          </>
        )}
      </div>
    </div>
  );
}
