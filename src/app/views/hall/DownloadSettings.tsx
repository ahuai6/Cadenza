import { useEffect, useRef, useState } from 'react';
import { tx } from '../../../i18n';
import { hallApi, type HallDownloadPreference, type HallSnapshot } from '../../hall/api';
import s from './MusicHall.module.css';

const fields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'number',
  'trackCount',
  'disc',
  'discCount',
  'year',
  'genre',
  'composer',
  'copyright',
  'isrc',
  'cover',
];

export function DownloadWriteOptions({
  value,
  change,
}: {
  value: HallDownloadPreference;
  change: (patch: Partial<HallDownloadPreference>) => void;
}) {
  return (
    <div className={s.writeOptions}>
      <fieldset>
        <legend>{tx('hall.downloadTags')}</legend>
        {fields.map((field) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={value.fields.includes(field)}
              onChange={(event) =>
                change({
                  fields: event.currentTarget.checked
                    ? [...value.fields, field]
                    : value.fields.filter((key) => key !== field),
                })
              }
            />
            {tx('hall.tag.' + field)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{tx('hall.downloadLyrics')}</legend>
        <label>
          {tx('hall.lyricStorage')}
          <select
            disabled={value.lyric === 'none'}
            value={value.lyricFile}
            onChange={(event) =>
              change({ lyricFile: event.currentTarget.value as HallDownloadPreference['lyricFile'] })
            }
          >
            {(['embedded', 'external', 'both'] as const).map((option) => (
              <option value={option} key={option}>
                {tx('hall.lyricStorage.' + option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tx('hall.lyricFormat')}
          <select
            value={value.lyric}
            onChange={(event) => change({ lyric: event.currentTarget.value as HallDownloadPreference['lyric'] })}
          >
            {(['native', 'lrc', 'none'] as const).map((option) => (
              <option value={option} key={option}>
                {tx('hall.lyricOption.' + option)}
              </option>
            ))}
          </select>
        </label>
        {(['translation', 'transliteration'] as const).map((track) => (
          <label key={track}>
            <input
              type="checkbox"
              disabled={value.lyric === 'none'}
              checked={value.languageTracks.includes(track)}
              onChange={(event) =>
                change({
                  languageTracks: event.currentTarget.checked
                    ? [...value.languageTracks, track]
                    : value.languageTracks.filter((key) => key !== track),
                })
              }
            />
            {tx('hall.lyricTrack.' + track)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function DownloadSettings({ providers }: { providers: HallSnapshot['providers'] }) {
  const [scope, setScope] = useState('global');
  const [value, setValue] = useState<HallDownloadPreference>();
  const [patch, setPatch] = useState<Partial<HallDownloadPreference>>({});
  const [status, setStatus] = useState('');
  const run = useRef(0);
  async function load(command: 'read' | 'save' | 'inherit' | 'folder') {
    const ticket = ++run.current;
    setStatus('');
    try {
      const result = await hallApi?.downloadSettings(scope, command, patch);
      if (ticket !== run.current || !result) return;
      setValue(result);
      if (command !== 'folder') setPatch({});
      if (command !== 'read') setStatus('hall.downloadSettingsSaved');
    } catch {
      if (ticket === run.current) setStatus('hall.downloadSettingsError');
    }
  }
  useEffect(() => {
    setValue(undefined);
    void load('read');
    return () => {
      run.current++;
    };
  }, [scope]);
  const change = (next: Partial<HallDownloadPreference>) => setPatch((prior) => ({ ...prior, ...next }));
  const actual = value && { ...value, ...patch };
  return (
    <section className={s.block + ' ' + s.catalog + ' ' + s.downloadSettings}>
      <h2>{tx('hall.downloadSettings')}</h2>
      <div className={s.catalogTabs}>
        <label>
          {tx('hall.downloadScope')}
          <select value={scope} onChange={(event) => setScope(event.currentTarget.value)}>
            <option value="global">{tx('hall.downloadGlobal')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label ? tx(p.label) : p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void load('folder')}>
          {tx('hall.downloadChooseFolder')}
        </button>
        {actual?.hasDirectory && <small>{tx('hall.downloadFolderSet')}</small>}
      </div>
      {actual && (
        <>
          <div className={s.catalogTabs}>
            <label>
              {tx('hall.downloadQuality')}
              <select
                value={actual.tier || ''}
                onChange={(event) => change({ tier: event.currentTarget.value as HallDownloadPreference['tier'] })}
              >
                {!actual.tier && <option value="">{tx('hall.downloadAuto')}</option>}
                {(['standard', 'high', 'lossless'] as const).map((tier) => (
                  <option key={tier} value={tier}>
                    {tx('hall.tier.' + tier)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tx('hall.downloadNaming')}
              <select
                value={actual.naming}
                onChange={(event) => change({ naming: event.currentTarget.value as HallDownloadPreference['naming'] })}
              >
                {(['artist-title', 'title', 'numbered'] as const).map((item) => (
                  <option key={item} value={item}>
                    {tx('hall.naming.' + item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tx('hall.downloadConflict')}
              <select
                value={actual.conflict}
                onChange={(event) =>
                  change({ conflict: event.currentTarget.value as HallDownloadPreference['conflict'] })
                }
              >
                <option value="keep">{tx('hall.conflict.keep')}</option>
                <option value="skip">{tx('hall.conflict.skip')}</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={actual.importTrack}
                onChange={(event) => change({ importTrack: event.currentTarget.checked })}
              />
              {tx('hall.downloadImport')}
            </label>
          </div>
          <DownloadWriteOptions value={actual} change={change} />
          <div className={s.catalogTabs}>
            <button
              className={s.saveDownloadSettings}
              type="button"
              disabled={!Object.keys(patch).length}
              onClick={() => void load('save')}
            >
              {tx('hall.saveDownloadSettings')}
            </button>
            {scope !== 'global' && (
              <button type="button" onClick={() => void load('inherit')}>
                {tx('hall.inheritDownloadSettings')}
              </button>
            )}
          </div>
        </>
      )}
      <p role="status">{status && tx(status)}</p>
    </section>
  );
}
