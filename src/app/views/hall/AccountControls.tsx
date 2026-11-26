import { useEffect, useRef, useState } from 'react';
import { tx } from '../../../i18n';
import { hallApi, type HallLogin, type HallSnapshot } from '../../hall/api';
import s from './MusicHall.module.css';

export function AccountControls({
  provider,
  accounts,
  refresh,
}: {
  provider: string;
  accounts: HallSnapshot['accounts'];
  refresh: () => Promise<void>;
}) {
  const [login, setLogin] = useState<HallLogin | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const current = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  async function begin() {
    const run = ++generation.current;
    if (current.current) void hallApi?.account(provider, 'cancel', { id: current.current });
    current.current = undefined;
    setLogin(null);
    setMessage('');
    setWorking(true);
    try {
      const result = await hallApi!.account(provider, provider === 'apple' ? 'import' : 'begin');
      if (run !== generation.current) {
        if (result.ok && result.data.id) void hallApi?.account(provider, 'cancel', { id: result.data.id });
        return;
      }
      if (!result.ok) {
        if (provider === 'apple') {
          if (result.code !== 'cancelled') setMessage(tx('hall.appleImportFailed'));
          return;
        }
        setMessage('二维码暂时不可用，请刷新后重试。');
        return;
      }
      if (provider === 'apple') {
        await refresh();
        return;
      }
      current.current = result.data.id;
      setLogin(result.data);
    } catch {
      if (run === generation.current)
        setMessage(provider === 'apple' ? tx('hall.appleImportFailed') : '二维码暂时不可用，请刷新后重试。');
    } finally {
      if (run === generation.current) setWorking(false);
    }
  }
  useEffect(
    () => () => {
      generation.current++;
      if (current.current) void hallApi?.account(provider, 'cancel', { id: current.current });
    },
    [provider],
  );
  useEffect(() => {
    if (!login?.id || !['waiting', 'confirm'].includes(login.phase)) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const tick = async () => {
      try {
        const answer = await hallApi!.account(provider, 'poll', { id: login.id });
        if (!active) return;
        if (!answer.ok) {
          setMessage('授权查询暂时失败。');
          timer = setTimeout(tick, 4000);
          return;
        }
        if (answer.data.phase === 'connected') {
          current.current = undefined;
          setLogin(null);
          setMessage('账号已连接。');
          await refresh();
          return;
        }
        if (answer.data.phase === 'expired') {
          setLogin({ ...login, phase: 'expired' });
          return;
        }
        setMessage(answer.data.phase === 'confirm' ? '请在手机上确认授权。' : '等待扫码。');
        timer = setTimeout(tick, 2200);
      } catch {
        if (active) timer = setTimeout(tick, 4000);
      }
    };
    timer = setTimeout(tick, 2200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login, provider]);
  return (
    <div className={s.accountControls}>
      <button disabled={working} type="button" onClick={() => void begin()}>
        {provider === 'apple' ? tx('hall.appleImport') : login ? '刷新二维码' : '二维码登录'}
      </button>
      {accounts.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={async () => {
            try {
              const reply = await hallApi!.account(provider, 'logout', { account: entry.id });
              if (!reply.ok) {
                setMessage('退出失败，请重试。');
                return;
              }
              await refresh();
            } catch {
              setMessage('退出失败，请重试。');
            }
          }}
        >
          退出 {entry.name}
        </button>
      ))}
      {login?.image && login.phase !== 'expired' && (
        <div className={s.loginCard}>
          <img src={login.image} width={166} height={166} alt="用网易云音乐扫描授权二维码" />
          <button
            type="button"
            onClick={() => {
              generation.current++;
              if (current.current) void hallApi?.account(provider, 'cancel', { id: current.current });
              current.current = undefined;
              setLogin(null);
              setMessage('');
            }}
          >
            取消登录
          </button>
        </div>
      )}
      {login?.phase === 'expired' && <p role="status">二维码已过期。</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
