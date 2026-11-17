import React, { useState } from 'react';
import { BaseLayout } from '../components/BaseLayout';
import { AuthUser } from '../types/dvs';

interface AdminLoginViewProps {
  user: AuthUser | null;
  errorData?: string;
  onLogin: (username: string, password: string) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({
  user,
  errorData,
  onLogin,
  onNavigate,
  onLogout,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let valid = true;
    setUsernameError('');
    setPasswordError('');

    if (!username.trim()) {
      setUsernameError('Please enter your administrator username.');
      const userInp = document.getElementById('input-admin-username');
      if (userInp) userInp.focus();
      valid = false;
    }
    if (!password.trim()) {
      setPasswordError('Please enter your password.');
      if (valid) {
        const passInp = document.getElementById('input-admin-password');
        if (passInp) passInp.focus();
      }
      valid = false;
    }
    if (!valid) return;

    onLogin(username.trim(), password);
  };

  const hero = (
    <section className="hero">
      <h1>Staff Sign In</h1>
      <p>Sign in with your authorized election staff or auditor credentials.</p>
    </section>
  );

  return (
    <BaseLayout
      title="Administrator Sign In — DVS Civic Elections"
      containerClass="page-container-narrow"
      navAdminActive
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      hero={hero}
    >
      <div className="card">
        {errorData && (
          <p className="feedback-panel is-visible feedback-error" role="alert">
            {errorData}
          </p>
        )}

        <div className="form-container">
          <form
            name="f1"
            method="post"
            action="/AdminLogin"
            data-validate="admin-login"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="form-group">
              <label htmlFor="input-admin-username">Username</label>
              <input
                type="text"
                id="input-admin-username"
                name="username"
                className={`inp${usernameError ? ' inp-invalid' : ''}`}
                aria-invalid={usernameError ? 'true' : undefined}
                autoComplete="username"
                placeholder="Enter your staff username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <p
                id="error-admin-username"
                className={`field-error${usernameError ? ' is-visible' : ''}`}
                role="alert"
              >
                {usernameError}
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="input-admin-password">Password</label>
              <input
                type="password"
                id="input-admin-password"
                name="password"
                className={`inp${passwordError ? ' inp-invalid' : ''}`}
                aria-invalid={passwordError ? 'true' : undefined}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p
                id="error-admin-password"
                className={`field-error${passwordError ? ' is-visible' : ''}`}
                role="alert"
              >
                {passwordError}
              </p>
            </div>

            <div className="form-group">
              <button type="submit" className="btn btn-primary">
                Sign In
              </button>
            </div>
          </form>
        </div>
      </div>
    </BaseLayout>
  );
};
