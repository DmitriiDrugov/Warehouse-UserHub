"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

export type ModelId =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

const MODELS: { id: ModelId; label: string; description: string }[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku",
    description: "Fastest · lower cost",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet",
    description: "Balanced · default",
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus",
    description: "Most capable · slower",
  },
];

const STORAGE_KEY = "ai_model_preference";
export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";

export function useSelectedModel(): [ModelId, (m: ModelId) => void] {
  const [model, setModelState] = useState<ModelId>(DEFAULT_MODEL);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ModelId | null;
    if (stored && MODELS.some((m) => m.id === stored)) {
      setModelState(stored);
    }
  }, []);

  const setModel = (m: ModelId) => {
    localStorage.setItem(STORAGE_KEY, m);
    setModelState(m);
  };

  return [model, setModel];
}

export function ModelSelectorDropdown() {
  const [model, setModel] = useSelectedModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const current = MODELS.find((m_) => m_.id === model) ?? MODELS[1]!;

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low border border-border-subtle rounded-lg hover:bg-surface-container transition-colors"
      >
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
        <div className="flex flex-col items-start leading-none">
          <span className="text-[10px] text-outline uppercase font-bold tracking-wide">Model</span>
          <span className="font-label text-label text-on-surface">{current.label}</span>
        </div>
        <Icon name="expand_more" size={16} className="text-on-surface-variant" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface-container-lowest border border-border-subtle rounded-lg shadow-lg z-50 overflow-hidden">
          {MODELS.map((m_) => (
            <button
              key={m_.id}
              type="button"
              onClick={() => {
                setModel(m_.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low transition-colors ${
                m_.id === model ? "bg-surface-container" : ""
              }`}
            >
              <div className="flex-1">
                <div className="font-label text-label text-on-surface">{m_.label}</div>
                <div className="font-label text-[11px] text-on-surface-variant">{m_.description}</div>
              </div>
              {m_.id === model && (
                <Icon name="check" size={16} className="text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
