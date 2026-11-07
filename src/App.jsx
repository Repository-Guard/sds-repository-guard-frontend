import { useCallback, useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const KEY = 'sds-guard-token';

const SOURCES = {
  webhook: ['Webhooks GitHub', 'Voit les forks, pushes, changements d’accès et de visibilité. Ne voit ni les lectures ni les clones.'],
  traffic: ['Compteurs de clones', 'Voit une hausse de clones sur 14 jours, sans dire qui. Vos propres clones et la CI comptent aussi.'],
  access: ['Permissions réelles', 'Vérifie lecture seule, dépôt privé, fork désactivé et échéance. Ne voit pas ce qui est lu.'],
  audit: ['Journal d’audit', 'Voit clones, fetch et ZIP par compte (clones: GitHub Enterprise Cloud). Ne voit ni captures ni copies manuelles.'],
  leak: ['Veille de fuite', 'Retrouve vos marqueurs dans des dépôts GitHub accessibles au token. Ne voit pas les fuites hors GitHub.'],
};
const LEVEL = { critical: 'Critique', warning: 'Alerte', info: 'Info' };
const TASKS = [
  ['poll-traffic', 'Relever le trafic'],
  ['check-access', 'Vérifier les accès'],
  ['poll-audit', 'Importer le journal d’audit'],
  ['leak-sweep', 'Chercher les fuites'],
];

async function api(path, token, method = 'GET', body) {
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) throw new Error('AUTH');
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const first = json && json.errors ? Object.values(json.errors)[0][0] : null;
    throw new Error(first || (json && json.message) || 'HTTP ' + r.status);
  }
  return json;
}

const when = (d) => (d ? new Date(d).toLocaleString('fr-FR') : 'jamais');
function remaining(d) {
  const m = Math.round((new Date(d) - Date.now()) / 60000);
  if (m < 0) return 'dépassée de ' + Math.abs(m) + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Login({ onToken, error }) {
  const [value, setValue] = useState('');
  return (
    <main className="login">
      <h1>Repository Guard</h1>
      <p>Saisissez le jeton du tableau de bord.</p>
      <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <button onClick={() => onToken(value.trim())} disabled={value.trim().length < 32}>Se connecter</button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function NewEvaluation({ repos, onCreate }) {
  const selected = repos.filter((r) => r.is_selected);
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('SDS-EVAL-2026-001');
  const [login, setLogin] = useState('');
  const [ids, setIds] = useState([]);
  const toggle = (id) => setIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const submit = async (e) => {
    e.preventDefault();
    const ok = await onCreate({ reference: reference.trim(), evaluator_login: login.trim(), repository_ids: ids });
    if (ok) setOpen(false);
  };
  if (!open) return <button onClick={() => setOpen(true)}>Nouvelle évaluation</button>;
  return (
    <form className="form" onSubmit={submit}>
      <label>Référence<input type="text" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      <label>Compte GitHub de l’évaluateur<input type="text" value={login} placeholder="3WheelsAI" onChange={(e) => setLogin(e.target.value)} /></label>
      <fieldset>
        <legend>Dépôts inclus</legend>
        {selected.length === 0 && <p className="muted">Cochez d’abord les dépôts dans la section Dépôts.</p>}
        {selected.map((r) => (
          <label key={r.id} className="repo"><input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} /><span>{r.full_name}</span></label>
        ))}
      </fieldset>
      <p className="muted">Deux marqueurs par dépôt seront générés. L’accès ne démarre qu’avec le bouton « Démarrer l’évaluation ».</p>
      <div className="row">
        <button type="submit" disabled={!reference.trim() || !login.trim() || ids.length === 0}>Préparer l’évaluation</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}

function EvaluationCard({ e, onStart, onRevoke, onReport }) {
  const [show, setShow] = useState(false);
  const [hours, setHours] = useState(48);
  const prepared = !e.access_granted_at;
  const state = e.active ? 'on' : e.revoked_at ? 'off' : 'prep';
  return (
    <article className={'eval ' + state}>
      <div>
        <h3>{e.reference}</h3>
        <p>{e.evaluator_login} sur {e.repositories.join(', ')}</p>
        <p className="muted">
          {prepared ? 'Préparée, accès non démarré.' : 'Accès accordé : ' + when(e.access_granted_at) + '.'}
          {e.revoked_at ? ' Révoqué : ' + when(e.revoked_at) + '.' : ''}
        </p>
        <div className="row">
          <button className="ghost" onClick={() => setShow(!show)}>{show ? 'Masquer' : 'Afficher'} les {e.markers.length} marqueurs</button>
          <button className="ghost" onClick={() => onReport(e)}>Rapport</button>
        </div>
        {show && (
          <div>
            <pre className="markers">{e.markers.join('\n')}</pre>
            <button className="ghost" onClick={() => navigator.clipboard.writeText(e.markers.join('\n'))}>Copier</button>
          </div>
        )}
      </div>
      <div className="clock">
        {e.active && (<><strong>{remaining(e.deadline_at)}</strong><span>avant l’échéance</span><button className="danger" onClick={() => onRevoke(e)}>Retirer l’accès</button></>)}
        {prepared && (
          <>
            <label className="hours">Durée (heures)<input type="number" min="1" max="168" value={hours} onChange={(x) => setHours(Number(x.target.value))} /></label>
            <button onClick={() => onStart(e, hours)}>Démarrer l’évaluation</button>
          </>
        )}
        {e.revoked_at && !e.active && <span>Accès retiré</span>}
      </div>
    </article>
  );
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const logout = () => { sessionStorage.removeItem(KEY); setToken(''); setData(null); };
  const login = (value) => { sessionStorage.setItem(KEY, value); setToken(value); };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [overview, alerts, events, traffic, repos] = await Promise.all(
        ['/overview', '/alerts', '/events', '/traffic', '/repositories'].map((p) => api(p, token))
      );
      setData({ overview, alerts, events, traffic, repos });
      setError('');
    } catch (e) {
      if (e.message === 'AUTH') {
        sessionStorage.removeItem(KEY);
        setToken('');
        setError('Jeton refusé.');
      } else setError('API injoignable (' + e.message + ').');
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  // Retourne le résultat, ou null si l'action a échoué (l'erreur est affichée).
  const act = async (path, method = 'POST', body) => {
    try {
      const r = await api(path, token, method, body);
      setError('');
      await load();
      return r;
    } catch (e) {
      setError(e.message === 'AUTH' ? 'Jeton refusé.' : 'Action refusée : ' + e.message);
      return null;
    }
  };

  const create = async (body) => {
    const r = await act('/evaluations', 'POST', body);
    if (r) setNotice('Évaluation préparée. Affichez les marqueurs, posez-les dans les projets, puis démarrez l’évaluation.');
    return Boolean(r);
  };
  const start = async (e, hours) => {
    if (!window.confirm('Démarrer la fenêtre de ' + hours + ' h pour ' + e.evaluator_login + ' ? Invitez ensuite le compte avec le rôle Read sur chaque dépôt.')) return;
    if (await act('/evaluations/' + e.id + '/start', 'POST', { hours })) setNotice('Évaluation démarrée. Invitez maintenant ' + e.evaluator_login + ' avec le rôle Read, puis lancez « Vérifier les accès ».');
  };
  const revoke = async (e) => {
    if (!window.confirm('Retirer l’accès de ' + e.evaluator_login + ' ?')) return;
    if (await act('/evaluations/' + e.id + '/revoke')) setNotice('Retrait lancé. Vérifiez les alertes : un retrait incomplet y apparaît en critique.');
  };
  const report = async (e) => {
    const r = await act('/evaluations/' + e.id + '/report', 'GET');
    if (!r) return;
    download(r.filename, r.content);
    download(r.filename + '.sha256', r.sha256 + '  ' + r.filename + '\n');
    setNotice('Rapport téléchargé avec son fichier .sha256. Empreinte : ' + r.sha256);
  };
  const runTask = async (task) => {
    if (await act('/run/' + task)) setNotice('Contrôle lancé en arrière-plan. Actualisez dans quelques secondes.');
  };

  if (!token) return <Login onToken={login} error={error} />;
  if (!data) return <main><p>{error || 'Chargement…'}</p></main>;
  const { overview, alerts, events, traffic, repos } = data;

  return (
    <main>
      <header>
        <div><h1>Repository Guard</h1><p>Suivi des dépôts d’évaluation de Shalom Digital Solutions</p></div>
        <div className="row"><button onClick={load}>Actualiser</button><button className="ghost" onClick={logout}>Quitter</button></div>
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section>
        <h2>Évaluations</h2>
        {overview.evaluations.length === 0 && <p className="muted">Aucune évaluation pour le moment.</p>}
        {overview.evaluations.map((e) => (
          <EvaluationCard key={e.id} e={e} onStart={start} onRevoke={revoke} onReport={report} />
        ))}
        <NewEvaluation repos={repos} onCreate={create} />
      </section>

      <section>
        <h2>Alertes <small>{overview.critical_alerts} critique(s), {overview.warning_alerts} à examiner</small></h2>
        {alerts.length === 0 && <p className="muted">Aucune alerte. Ce silence ne prouve pas l’absence de copie : voir la couverture ci-dessous.</p>}
        {alerts.map((a) => (
          <article key={a.id} className={'alert ' + a.severity + (a.acknowledged_at ? ' done' : '')}>
            <span className="level">{LEVEL[a.severity]}</span>
            <div><p>{a.message}</p><p className="muted">{when(a.created_at)}</p></div>
            {!a.acknowledged_at && <button className="ghost" onClick={() => act('/alerts/' + a.id + '/ack')}>Marquer comme vue</button>}
          </article>
        ))}
      </section>

      <section>
        <h2>Contrôles manuels</h2>
        <div className="row wrap">
          {TASKS.map(([task, label]) => <button key={task} className="ghost" onClick={() => runTask(task)}>{label}</button>)}
        </div>
      </section>

      <section>
        <h2>Ce que le contrôle couvre</h2>
        <table>
          <thead><tr><th>Source</th><th>État</th><th>Dernier passage</th><th>Portée</th></tr></thead>
          <tbody>
            {Object.entries(overview.sources).map(([k, s]) => (
              <tr key={k}>
                <td>{SOURCES[k][0]}</td>
                <td className={s.ok === null ? 'muted' : s.ok ? 'good' : 'bad'}>{s.ok === null ? 'Jamais exécuté' : s.ok ? 'À jour' : 'Dégradé'}{s.note ? ' : ' + s.note : ''}</td>
                <td>{when(s.at)}</td>
                <td>{SOURCES[k][1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Dépôts</h2>
        <button onClick={() => act('/repositories/sync')}>Synchroniser depuis GitHub</button>
        {repos.map((r) => (
          <label key={r.id} className="repo">
            <input type="checkbox" checked={r.is_selected} onChange={() => act('/repositories/' + r.id + '/toggle')} />
            <span>{r.full_name}</span>
            <span className="muted">{r.visibility}{r.allow_forking ? ', fork autorisé' : ''}</span>
          </label>
        ))}
      </section>

      <section>
        <h2>Compteurs de clones et de vues</h2>
        {overview.traffic_summary.length === 0 && <p className="muted">Aucun dépôt coché.</p>}
        <div className="traffic-grid">
          {overview.traffic_summary.map((t) => {
            const [org, name] = t.full_name.split('/');
            const polled = Boolean(t.at);
            const watch = polled && t.clones > 0;
            return (
              <article key={t.full_name} className={'tcard' + (watch ? ' warn' : '')}>
                <div className="tcard-head">
                  <div><h3>{name}</h3><span className="muted">{org}</span></div>
                  <span className={'badge ' + (!polled ? 'idle' : watch ? 'warn' : 'ok')}>
                    {!polled ? 'Pas encore relevé' : watch ? 'Clones à corréler' : 'Aucune activité'}
                  </span>
                </div>
                {polled && (
                  <dl className="stats">
                    <div><dt>Clones</dt><dd>{t.clones}</dd><span>{t.clone_uniques} unique(s)</span></div>
                    <div><dt>Vues</dt><dd>{t.views}</dd><span>{t.view_uniques} unique(s)</span></div>
                  </dl>
                )}
                <p className="tcard-foot">{polled ? 'Fenêtre glissante de 14 jours. Relevé du ' + when(t.at) + '.' : 'Lancez « Relever le trafic ».'}</p>
              </article>
            );
          })}
        </div>
        <table>
          <thead><tr><th>Dépôt</th><th>Jour</th><th>Clones</th><th>Vues</th></tr></thead>
          <tbody>
            {traffic.map((t) => (
              <tr key={t.id}><td>{t.repository?.full_name}</td><td>{String(t.day).slice(0, 10)}</td><td>{t.clones} ({t.clone_uniques} uniques)</td><td>{t.views} ({t.view_uniques} uniques)</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Événements reçus</h2>
        {events.length === 0 && <p className="muted">Aucun événement.</p>}
        {events.map((e) => (
          <p key={e.id} className="event">{when(e.occurred_at)} — {e.event_type}{e.action ? ' / ' + e.action : ''} par {e.actor_login || 'inconnu'} sur {e.repository?.full_name || e.summary?.repo || '—'} ({e.source})</p>
        ))}
      </section>
    </main>
  );
}
