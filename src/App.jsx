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

async function api(path, token, method = 'GET') {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  if (r.status === 401) throw new Error('AUTH');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const when = (d) => (d ? new Date(d).toLocaleString('fr-FR') : 'jamais');
function remaining(d) {
  const m = Math.round((new Date(d) - Date.now()) / 60000);
  if (m < 0) return 'dépassée de ' + Math.abs(m) + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
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

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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

  const act = async (path) => {
    try { await api(path, token, 'POST'); } catch (e) { setError('Action refusée (' + e.message + ').'); }
    load();
  };
  const login = (value) => { sessionStorage.setItem(KEY, value); setToken(value); };
  const logout = () => { sessionStorage.removeItem(KEY); setToken(''); setData(null); };

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

      <section>
        <h2>Évaluations</h2>
        {overview.evaluations.length === 0 && <p className="muted">Aucune évaluation. Créez-en une avec guard:evaluation prepare.</p>}
        {overview.evaluations.map((e) => (
          <article key={e.id} className={'eval ' + (e.active ? 'on' : 'off')}>
            <div>
              <h3>{e.reference}</h3>
              <p>{e.evaluator_login} sur {e.repositories.join(', ')}</p>
              <p className="muted">{e.markers} marqueur(s) posé(s). Accès accordé : {when(e.access_granted_at)}. {e.revoked_at ? 'Révoqué : ' + when(e.revoked_at) : ''}</p>
            </div>
            <div className="clock">
              {e.active ? (<><strong>{remaining(e.deadline_at)}</strong><span>avant l’échéance</span>
                <button className="danger" onClick={() => window.confirm('Retirer l’accès de ' + e.evaluator_login + ' ?') && act('/evaluations/' + e.id + '/revoke')}>Retirer l’accès</button></>)
                : <span>{e.revoked_at ? 'Accès retiré' : 'Pas encore démarrée'}</span>}
            </div>
          </article>
        ))}
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
