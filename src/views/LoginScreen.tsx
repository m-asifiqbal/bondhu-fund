import React, { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../components/common/LogoMark';
import { Globe, KeyRound, Loader2, LockKeyhole, LogIn, Moon, ShieldCheck, Sun, User } from 'lucide-react';
import { PasswordInput } from '../components/common/PasswordInput';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/common/Modal';
import { changeOwnPassword, licenseActivate, licenseCheck, licenseRegisterUser } from '../services/db';

/** The licence gate in the main process answers a sign-in with LICENSE_PIN_REQUIRED:<reason>|<message> or LICENSE_LOCKED:<reason>|<message>. */
const parseGate = (msg: string) => { const m = /^LICENSE_(PIN_REQUIRED|REGISTER|LOCKED):(\w+)\|([\s\S]*)$/.exec(String(msg)); return m ? { pin: m[1] === 'PIN_REQUIRED', register: m[1] === 'REGISTER', reason: m[2], message: m[3] } : null; };
const groupPin = (raw: string) => raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12).replace(/(.{4})(?=.)/g, '$1-');

/** Full-screen sign-in. Shown whenever there is no session (app start, sign-out, session ended). */
export const LoginScreen: React.FC = () => {
  const { t, signIn, settings, orgName, language, toggleLanguage, isDarkMode, toggleDarkMode } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caps, setCaps] = useState(false);
  const [pinStep, setPinStep] = useState<null | { reason: string; user: string }>(null);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => { userRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError(t('auth.fill_both', 'Enter your username and password.')); return; }
    setBusy(true); setError('');
    try { await signIn(username.trim(), password); }
    catch (err: any) {
      let g = parseGate(err.message);
      if (g?.register) {
        // the computer is licensed for the whole customer but limits the number of users: count this user (online, no PIN), then sign in
        try { await licenseRegisterUser(username.trim()); await signIn(username.trim(), password); return; }
        catch (err2: any) { g = parseGate(err2.message); if (!g) { setError(err2.message); setPassword(''); return; } }
      }
      if (g && !g.pin && !g.register) {
        // refused because the licence is suspended or ended: it may have been renewed a minute ago, so ask the server once more and try again
        try { await licenseCheck(); await signIn(username.trim(), password); return; }
        catch (err2: any) { g = parseGate(err2.message); if (!g) { setError(err2.message); setPassword(''); return; } }
      }
      if (g?.pin) { setPinStep({ reason: g.reason, user: username.trim() }); setPin(''); setPinErr(''); }       // the password is right: ask for the activation PIN of this user
      else if (g) { setError(licenseText(g.reason, g.message)); setPassword(''); }
      else { setError(err.message); setPassword(''); }
    }
    finally { setBusy(false); }
  };
  const licenseText = (reason: string, vendor: string) => {
    const head: Record<string, string> = {
      suspended: t('license.t_suspended', 'This copy has been suspended'), revoked: t('license.t_revoked', 'This licence has been withdrawn'),
      not_allowed: t('license.t_not_allowed', 'This user is not on the licence'),
      expired: t('license.t_expired', 'The licence period has ended'), needs_check: t('license.t_needs_check', 'The licence needs to be confirmed online'),
    };
    const body: Record<string, string> = {
      suspended: t('license.b_suspended', 'The software provider has paused this licence. It opens again by itself once the provider resumes it.'),
      revoked: t('license.b_revoked', 'Please contact the software provider.'),
      not_allowed: t('license.b_not_allowed', 'Ask the software provider to add your username to the licence.'),
      expired: t('license.b_expired', 'Please renew the monthly licence with the software provider. The app opens again by itself a few minutes after the renewal, or press "Check again".'),
      needs_check: t('license.b_needs_check', 'This computer has not been able to reach the licence server for a long time. Connect to the internet and press "Check again".'),
    };
    return [head[reason], body[reason], vendor].filter(Boolean).join(' · ');
  };
  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinStep) return;
    if (pin.replace(/-/g, '').length < 12) { setPinErr(t('license.pin_short', 'The PIN has 12 letters and digits (for example ABCD-EFGH-JKLM).')); return; }
    setBusy(true); setPinErr('');
    try {
      await licenseActivate(pin, pinStep.user);
      await signIn(pinStep.user, password);
    } catch (err: any) {
      const g = parseGate(err.message);
      if (g && !g.pin) { setPinStep(null); setError(licenseText(g.reason, g.message)); setPassword(''); }
      else if (g) setPinErr(t('license.pin_not_valid', 'That PIN does not activate this user.'));
      else setPinErr(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen w-full flex bg-slate-100 dark:bg-[#0b1317]">
      {/* brand panel */}
      <div className="hidden lg:flex w-[44%] relative overflow-hidden bg-gradient-to-br from-[#0f4a3c] via-[#0d3d33] to-[#082124] text-white p-12 flex-col justify-between">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -left-16 bottom-10 w-72 h-72 rounded-full bg-emerald-400/10" />
        <div className="relative flex items-center gap-3">
          {settings?.org_logo
            ? <LogoMark src={settings.org_logo} className="w-12 h-12" surface="dark" />
            : <span className="w-12 h-12 rounded-2xl bg-[#fae2aa] text-[#082124] flex items-center justify-center font-black">BF</span>}
          <div>
            <div className="text-lg font-black leading-tight">{orgName}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">{t('auth.tagline', 'Savings fund manager')}</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-black leading-tight max-w-md">{t('auth.hero', 'Every taka accounted for.')}</h1>
          <p className="mt-4 text-sm text-emerald-100/80 max-w-md leading-relaxed">
            {t('auth.hero_sub', 'Members, monthly dues, expenses and investments — offline, backed up daily, in English and বাংলা.')}
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-emerald-100/70">
          <ShieldCheck size={15} />{t('auth.offline', 'Your data stays on this computer.')}
        </div>
      </div>

      {/* form */}
      <div className="flex-1 flex flex-col">
        <div className="flex justify-end gap-2 p-5">
          <button type="button" onClick={toggleLanguage} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-[#283e4a] bg-white dark:bg-[#16252d] text-xs font-bold text-slate-700 dark:text-slate-200">
            <Globe size={14} />{language === 'bn' ? 'English' : 'বাংলা'}
          </button>
          <button type="button" onClick={toggleDarkMode} aria-label="Theme" className="p-2 rounded-xl border border-slate-300 dark:border-[#283e4a] bg-white dark:bg-[#16252d] text-slate-600 dark:text-slate-300">
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 pb-16">
          {pinStep ? (
            <form onSubmit={activate} className="login-zoom w-full max-w-sm" noValidate>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900 flex items-center justify-center"><KeyRound size={22} /></div>
              <h2 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">{t('license.pin_step_title', 'Activation PIN needed')}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {pinStep.reason === 'invalid' ? t('license.b_invalid', 'Enter a new activation PIN from the software provider.')
                  : t('license.pin_step_body', 'The software provider must activate "{user}" on this computer. Enter the PIN you received for this user. It is asked only once.').replace('{user}', pinStep.user)}
              </p>
              <label className="form-label mt-6" htmlFor="login-pin">{t('license.pin_label', 'Activation PIN')}</label>
              <input id="login-pin" className="form-input text-center font-mono text-lg tracking-[0.25em] !py-3" value={pin} onChange={e => setPin(groupPin(e.target.value))}
                placeholder="XXXX-XXXX-XXXX" autoFocus autoComplete="off" spellCheck={false} maxLength={14} />
              {pinErr && <div role="alert" className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300">{pinErr}</div>}
              <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block mt-6">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{busy ? t('license.activating', 'Activating…') : t('license.activate', 'Activate')}
              </button>
              <button type="button" disabled={busy} onClick={() => { setPinStep(null); setPassword(''); setPin(''); }} className="btn btn-outline btn-block mt-3">{t('license.pin_back', 'Back to sign in')}</button>
              <p className="mt-6 text-[11px] text-slate-400 text-center">{t('license.pin_internet', 'The computer needs the internet for this one step.')}</p>
            </form>
          ) : (
          <form onSubmit={submit} className="login-zoom w-full max-w-sm" noValidate>
            <div className="lg:hidden flex items-center gap-3 mb-8">
              {settings?.org_logo
                ? <LogoMark src={settings.org_logo} className="w-11 h-11" />
                : <span className="w-11 h-11 rounded-xl bg-brand text-white flex items-center justify-center font-black">BF</span>}
              <span className="text-lg font-black text-slate-900 dark:text-white">{orgName}</span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white">{t('auth.title', 'Sign in')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.subtitle', 'Use your username and password.')}</p>

            <label className="form-label mt-7" htmlFor="login-user">{t('auth.username', 'Username')}</label>
            <div className="relative">
              <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input id="login-user" ref={userRef} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"
                className="form-input !pl-10 !py-3 !text-sm" placeholder={t('auth.username_ph', 'e.g. admin')} />
            </div>

            <label className="form-label mt-4" htmlFor="login-pass">{t('auth.password', 'Password')}</label>
            <PasswordInput id="login-pass" value={password} onChange={e => setPassword(e.target.value)}
              onKeyUp={e => setCaps(e.getModifierState('CapsLock'))} autoComplete="current-password"
              icon={<LockKeyhole size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />}
              className="form-input !pl-10 !py-3 !text-sm" placeholder="••••••••" />
            {caps && <p className="mt-1.5 text-[11px] font-semibold text-amber-600">{t('auth.caps', 'Caps Lock is on')}</p>}

            {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</div>}

            <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block mt-6">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}{t('auth.sign_in', 'Sign in')}
            </button>
            <p className="mt-6 text-[11px] text-slate-400 text-center">{t('auth.help', 'Forgot your password? Ask an administrator to set a new one.')}</p>
          </form>
          )}
        </div>
      </div>
    </div>
  );
};

/** Shown once after signing in while the admin account still uses its default password. */
export const ChangePasswordPrompt: React.FC<{ open: boolean; onDone: () => void; forced?: boolean }> = ({ open, onDone, forced }) => {
  const { t, showToast, triggerRefresh } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    if (next !== again) { setErr(t('auth.mismatch', 'The new passwords do not match.')); return; }
    setBusy(true);
    try {
      await changeOwnPassword(cur, next);
      showToast(t('auth.changed', 'Password changed'));
      setCur(''); setNext(''); setAgain('');
      triggerRefresh(); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onDone} locked={busy} size="sm" icon={<LockKeyhole size={18} />}
      title={t('auth.change_title', 'Change your password')}
      subtitle={forced ? t('auth.change_default', 'You are using the default password. Please choose a new one.') : undefined}
      footer={<>
        <button type="button" onClick={onDone} disabled={busy} className="btn btn-cancel">{forced ? t('auth.later', 'Later') : t('common.cancel', 'Cancel')}</button>
        <button type="button" onClick={save} disabled={busy || !cur || !next} className="btn btn-primary">{busy && <Loader2 size={14} className="animate-spin" />}{t('auth.change_btn', 'Change password')}</button>
      </>}>
      <div className="space-y-3.5">
        <div><label className="form-label">{t('auth.current', 'Current password')}</label><PasswordInput value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></div>
        <div><label className="form-label">{t('auth.new', 'New password')}</label><PasswordInput value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
          <span className="form-hint">{t('auth.rules', 'At least 6 characters, different from the username.')}</span></div>
        <div><label className="form-label">{t('auth.repeat', 'Repeat new password')}</label><PasswordInput value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password"
          onKeyDown={e => { if (e.key === 'Enter') save(); }} /></div>
        {err && <div role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{err}</div>}
      </div>
    </Modal>
  );
};

export default LoginScreen;
