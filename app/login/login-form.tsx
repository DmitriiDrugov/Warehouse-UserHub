"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import {
  signInWithOAuthAction,
  signInWithPasswordAction,
  type LoginActionState,
} from "./actions";

const INPUT_CLASS =
  "w-full bg-surface-container-lowest border border-outline-variant rounded px-3 py-2 font-body-sm text-body-sm text-on-surface " +
  "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-on-surface-variant/60";

const INITIAL: LoginActionState = {};

export function LoginForm({
  next,
  oauthProviders,
  initialError,
}: {
  next?: string;
  oauthProviders: readonly string[];
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signInWithPasswordAction,
    INITIAL,
  );
  const error = state.error ?? initialError;

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        <fieldset disabled={pending} className="flex flex-col gap-5">
          {error ? (
            <div className="bg-error-container border border-error rounded p-3 flex items-start gap-3">
              <Icon name="warning" size={20} className="text-error mt-0.5 shrink-0" />
              <div>
                <div className="font-label text-label text-on-error-container">Authentication Failed</div>
                <div className="font-body-sm text-body-sm text-on-error-container mt-0.5">{error}</div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="font-label text-label text-on-surface">
              Operator Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="id@warehouse.local"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="font-label text-label text-on-surface">
                Secure Key
              </label>
              <a href="#" tabIndex={-1} className="font-label text-label text-primary hover:underline">
                Reset Key
              </a>
            </div>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className={INPUT_CLASS}
            />
          </div>

          {next ? <input type="hidden" name="next" value={next} /> : null}
        </fieldset>

        <Button
          type="submit"
          block
          iconRight={<Icon name="login" size={16} />}
          disabled={pending}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 my-4 opacity-60">
        <span className="flex-1 h-px bg-border-subtle" />
        <span className="font-label text-label text-status-neutral uppercase tracking-wider" style={{ fontSize: "10px" }}>Or</span>
        <span className="flex-1 h-px bg-border-subtle" />
      </div>

      {oauthProviders.length > 0 ? (
        <form action={signInWithOAuthAction} className="flex flex-col gap-2">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          {oauthProviders.map((p) => (
            <Button
              key={p}
              type="submit"
              name="provider"
              value={p}
              variant="secondary"
              block
              icon={<Icon name="badge" size={16} />}
            >
              Sign in with {p}
            </Button>
          ))}
        </form>
      ) : (
        <Button variant="secondary" block icon={<Icon name="badge" size={16} />} disabled>
          Sign in with SSO
        </Button>
      )}
    </>
  );
}
