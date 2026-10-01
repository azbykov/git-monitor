"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

export function ActionButton(props: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${
          props.primary
            ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            : "border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        }`}
      >
        {pending ? props.pendingLabel : props.label}
      </button>
      {state && !pending && (
        <p className={`max-w-72 text-right text-xs ${state.ok ? "text-zinc-500" : "text-red-600"}`}>{state.message}</p>
      )}
    </form>
  );
}
