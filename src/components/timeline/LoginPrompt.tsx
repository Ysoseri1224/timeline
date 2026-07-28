import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

interface LoginPromptProps {
  busy: boolean;
  error: string;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}

export default function LoginPrompt({ busy, error, onSubmit, onClose }: LoginPromptProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState('');

  useGSAP(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .fromTo('.login-backdrop', { autoAlpha: 0 }, { autoAlpha: 1, duration: reduced ? 0.1 : 0.28 })
      .fromTo('.login-paper', { autoAlpha: 0, y: reduced ? 0 : 18, scale: reduced ? 1 : 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: reduced ? 0.14 : 0.42 }, 0.04);
  }, { scope: rootRef });

  return (
    <div ref={rootRef} className="login-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="login-paper"
        aria-label="验证编辑密码"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(password);
        }}
      >
        <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="login-kicker">private note</span>
        <h2>翻到可以书写的那一页</h2>
        <p>浏览始终公开。密码只用于开启这台设备上的编辑状态。</p>
        <label>
          <span>编辑密码</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="paper-button paper-button--primary" disabled={busy || !password}>
          {busy ? '正在验证…' : '开始书写'}
        </button>
      </form>
    </div>
  );
}
