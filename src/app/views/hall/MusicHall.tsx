import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { detectLang, lang as langStore, setLang, tx, words, type Lang } from '../../../i18n';
import { useStore } from '../../state';
import { applyUiFont } from '../../uifont';
import { Icon } from '../../ui/icons';
import { Turn } from '../../ui/kit';
import mark from '../../brand/mark.svg';
import { hallApi, type HallAppearance, type HallProvider, type HallSnapshot } from '../../hall/api';
import s from './MusicHall.module.css';

const providerName = (provider: HallProvider) => (provider.label ? tx(provider.label) : provider.name);
const initial: HallAppearance = { theme: 'light', tone: 'white', lang: '', uiFont: 'default' };
const navigation = ['discover', 'accounts'] as const;

export function MusicHall() {
  const [record, setRecord] = useState<HallSnapshot | null>(null);
  const [appearance, setAppearance] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [max, setMax] = useState(false);
  const [page, setPage] = useState<(typeof navigation)[number]>('discover');
  const [selected, select] = useState<string>();
  const main = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!hallApi) {
      setFailed(true);
      return;
    }
    let live = true;
    let appearanceUpdated = false;
    const offTheme = hallApi.onAppearance((value) => {
      appearanceUpdated = true;
      setAppearance(value);
    });
    const offMax = hallApi.onMaximized(setMax);
    hallApi
      .read()
      .then((value) => {
        if (!live) return;
        if (!value) {
          setFailed(true);
          return;
        }
        if (!appearanceUpdated) setAppearance(value.appearance);
        setRecord(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      offMax();
      offTheme();
    };
  }, []);
  const lng = (appearance.lang || detectLang()) as Lang;
  useLayoutEffect(() => {
    setLang(lng);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance.theme === 'system' ? (media.matches ? 'dark' : 'light') : appearance.theme;
      document.documentElement.dataset.tone = appearance.tone;
      document.documentElement.lang = lng;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance.theme, appearance.tone, lng]);
  const language = useStore(langStore, (value) => value.lang);
  useEffect(() => {
    void applyUiFont(language, appearance.uiFont, words(language));
  }, [language, appearance.uiFont]);

  const provider = record?.providers.find((p) => p.id === selected) || record?.providers[0];
  const move = (next: typeof page) => {
    if (next === page) return;
    setPage(next);
    main.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  };
  return (
    <div className={s.hall} data-test="music-hall">
      <header
        className={s.chrome}
        data-test="hall-titlebar"
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) void hallApi?.window('max');
        }}
      >
        <div className={s.brand}>
          <img src={mark} alt="" />
          <span>Cadenza</span>
        </div>
        <nav aria-label={tx('hall.title')} className={s.routes}>
          {navigation.map((key) => (
            <button type="button" key={key} aria-current={page === key ? 'page' : undefined} onClick={() => move(key)}>
              {tx('hall.' + key)}
            </button>
          ))}
        </nav>
        <div className={s.window}>
          <WindowCommand op="min" icon="min" label={tx('s.min')} />
          <WindowCommand op="max" icon={max ? 'restore' : 'max'} label={tx(max ? 's.restore' : 's.max')} />
          <WindowCommand op="close" icon="close" label={tx('s.close')} />
        </div>
      </header>
      <main ref={main} className={s.scroll} data-test="hall-scroll">
        <div className={s.page}>
          <h1 ref={heading} tabIndex={-1} className={s.title}>
            {tx(page === 'discover' ? 'hall.title' : 'hall.accounts')}
          </h1>
          {failed && <p role="status">{tx('hall.loadFail')}</p>}
          {record && (
            <Turn k={page}>
              {page === 'discover' && provider && <Discovery record={record} provider={provider} select={select} />}
              {page === 'accounts' && <Accounts record={record} />}
            </Turn>
          )}
        </div>
      </main>
    </div>
  );
}

function WindowCommand({ op, icon, label }: { op: 'min' | 'max' | 'close'; icon: string; label: string }) {
  return (
    <button type="button" data-op={op} aria-label={label} title={label} onClick={() => void hallApi?.window(op)}>
      <Icon n={icon} size={16} />
    </button>
  );
}

function Discovery({
  record,
  provider,
  select,
}: {
  record: HallSnapshot;
  provider: HallProvider;
  select: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const account = record.accounts.find((a) => a.provider === provider.id && a.state === 'connected');
  const status = (cap: keyof HallProvider['capabilities']) =>
    provider.capabilities[cap] === 'unavailable'
      ? 'hall.unavailable'
      : provider.capabilities[cap] === 'authorized' && !account
        ? 'hall.disconnected'
        : 'hall.available';
  const keyboard = (event: KeyboardEvent) => {
    const count = record.providers.length;
    const index = record.providers.indexOf(provider);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % count
            : event.key === 'ArrowLeft'
              ? (index + count - 1) % count
              : -1;
    if (next < 0) return;
    event.preventDefault();
    rail.current?.querySelectorAll('button')[next]?.focus();
    select(record.providers[next].id);
  };
  return (
    <>
      <div className={s.platforms} role="tablist" aria-label={tx('hall.platform')} onKeyDown={keyboard} ref={rail}>
        {record.providers.map((item) => (
          <button
            key={item.id}
            id={'platform-' + item.id}
            type="button"
            role="tab"
            aria-selected={provider === item}
            tabIndex={provider === item ? 0 : -1}
            onClick={() => select(item.id)}
          >
            {providerName(item)}
          </button>
        ))}
      </div>
      <div role="tabpanel" tabIndex={0} aria-labelledby={'platform-' + provider.id}>
        <Turn k={provider.id}>
          <div className={s.workspace}>
            <div className={s.content}>
              <section className={s.block + ' ' + s.search}>
                <span className={s.searchMark}>
                  <Icon n="search" size={23} />
                </span>
                <div className={s.searchText}>
                  <h2>{tx('hall.search')}</h2>
                  <p>{tx('hall.searchHint')}</p>
                </div>
                <Status label={status('search')} />
              </section>
              <div className={s.sections}>
                <Surface title="hall.recommendations" status={status('recommendations')} icon="note" />
                <Surface title="hall.charts" status={status('charts')} icon="lyrics" />
              </div>
            </div>
            <aside className={s.sidebar} aria-label={providerName(provider)}>
              <Surface title="hall.playlists" status={status('playlists')} icon="library">
                {account && <p>{account.name}</p>}
                {status('playlists') === 'hall.disconnected' && <p>{tx('hall.playlistsHint')}</p>}
              </Surface>
              <section className={s.block}>
                <h2>{tx('hall.actions')}</h2>
                <dl className={s.actions}>
                  <div>
                    <dt>{tx('hall.preview')}</dt>
                    <dd>{tx(status('preview'))}</dd>
                  </div>
                  <div>
                    <dt>{tx('hall.download')}</dt>
                    <dd>{tx(status('download'))}</dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
        </Turn>
      </div>
    </>
  );
}

function Status({ label }: { label: string }) {
  return (
    <span className={s.status}>
      <i aria-hidden="true" />
      {tx(label)}
    </span>
  );
}
function Surface({
  title,
  status,
  icon,
  children,
}: {
  title: string;
  status: string;
  icon: string;
  children?: ReactNode;
}) {
  return (
    <section className={s.block}>
      <Icon n={icon} size={21} />
      <h2>{tx(title)}</h2>
      {children}
      <Status label={status} />
    </section>
  );
}

function Accounts({ record }: { record: HallSnapshot }) {
  return (
    <div className={s.accountPage}>
      <section className={s.block}>
        <h2>{tx('hall.accountMusic')}</h2>
        <ul className={s.accountList}>
          {record.providers.map((p) => {
            const matches = record.accounts.filter((a) => a.provider === p.id);
            return (
              <li key={p.id}>
                <strong>{providerName(p)}</strong>
                {matches.length ? (
                  <ul>
                    {matches.map((a) => (
                      <li key={a.id}>
                        {a.name}
                        <Status
                          label={
                            a.state === 'connected'
                              ? 'hall.available'
                              : a.state === 'expired'
                                ? 'hall.expired'
                                : 'hall.disconnected'
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Status label={p.capabilities.account === 'unavailable' ? 'hall.unavailable' : 'hall.disconnected'} />
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className={s.block}>
        <h2>{tx('hall.accountAI')}</h2>
        <ul className={s.accountList}>
          {record.ai.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong>
                <small>{tx(p.auth === 'oauth' ? 'hall.oauth' : 'hall.key')}</small>
              </span>
              <Status label="hall.unavailable" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
