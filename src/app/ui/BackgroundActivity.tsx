import { useEffect, useRef, useState } from 'react';
import { Lib, type BackgroundTasks } from '../bridge';
import { lib, trackOf, useStore } from '../state';
import s from './BackgroundActivity.module.css';

const phaseLabel = {
  rhythm: '节奏分析',
  loudness: '响度分析',
  validate: '缓存校验',
  paused: '分析已暂停',
  idle: '',
};

const problemLabel: Record<string, string> = {
  'analysis PCM budget': '解码数据超出当前分析预算',
  'analysis file budget': '文件超出当前分析预算',
  'analysis duration unavailable': '暂时无法核实时长',
  fingerprint: '音频指纹验证失败',
  unavailable: '文件暂不可访问',
  protected: '受保护的文件',
  read: '无法读取音频',
};
export function BackgroundActivity({ className = '' }: { className?: string }) {
  const progress = useStore(lib, (value) => value.progress);
  const task = useStore(lib, (value) => value.analysisTask);
  const analyzing = useStore(lib, (value) => value.analysisFor);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<BackgroundTasks | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const active =
    progress.phase === 'scan' ||
    !!(progress.hashing || analyzing) ||
    task.phase === 'rhythm' ||
    task.phase === 'loudness' ||
    task.phase === 'validate';
  const work = [
    progress.phase === 'scan' && (progress.total ? `扫描 ${progress.done} / ${progress.total}` : '正在发现音乐文件'),
    progress.hashing > 0 && '计算音频指纹',
    (task.phase !== 'idle' || analyzing) && (phaseLabel[task.phase] || '节奏分析'),
    progress.queued > 0 && `指纹等待 ${progress.queued}`,
  ]
    .filter(Boolean)
    .join(' · ');
  useEffect(() => {
    if (!open || !Lib) return;
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await Lib!.taskDetails();
        if (alive) setDetails(value);
      } catch {
        if (alive) setDetails(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 850);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);
  if (!Lib) return null;
  const title = work || '后台任务详情';
  return (
    <>
      <button
        ref={button}
        className={s.button + ' ' + className}
        type="button"
        data-test="activity"
        data-active={active}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(e) => {
          const panel = popover.current;
          if (!panel) return;
          const rect = e.currentTarget.getBoundingClientRect();
          panel.style.right = Math.max(8, innerWidth - rect.right) + 'px';
          panel.style.top = rect.bottom + 8 + 'px';
          panel.togglePopover();
        }}
      >
        <span aria-hidden="true" />
      </button>
      <div
        ref={popover}
        popover="auto"
        className={s.popup}
        role="dialog"
        aria-label="后台任务"
        onToggle={(e) => setOpen(e.newState === 'open')}
      >
        <header>
          <b>后台任务</b>
          <button
            type="button"
            aria-label="关闭后台任务"
            onClick={() => {
              popover.current?.hidePopover();
              button.current?.focus();
            }}
          >
            ×
          </button>
        </header>
        <p role="status">{work || '当前没有运行中的任务'}</p>
        {(task.id || analyzing) && <p>{trackOf(task.id || analyzing)?.title}</p>}
        {details && (
          <>
            <dl>
              <div>
                <dt>已缓存</dt>
                <dd>{details.cached}</dd>
              </div>
              <div>
                <dt>待完成分析</dt>
                <dd>{details.pending}</dd>
              </div>
              <div>
                <dt>指纹排队</dt>
                <dd>{progress.queued}</dd>
              </div>
              <div>
                <dt>跳过</dt>
                <dd>{details.skipped}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>{details.failed}</dd>
              </div>
              <div>
                <dt>不可访问目录</dt>
                <dd>{progress.unavailable}</dd>
              </div>
            </dl>
            {details.recent.length > 0 && (
              <ul>
                {details.recent.map((item, i) => (
                  <li key={i}>
                    <b>{item.file}</b> <span>{problemLabel[item.reason] || item.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <button type="button" onClick={() => void Lib!.rescan()}>
          重新扫描并验证
        </button>
      </div>
    </>
  );
}
