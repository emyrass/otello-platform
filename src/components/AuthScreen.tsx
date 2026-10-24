import { useState } from "react";
import { useOtello } from "../context/Store.tsx";
import { ContractAddress } from "./ContractAddress.tsx";
import { Button, ErrorList, Field, TextInput } from "./ui.tsx";

export function AuthScreen() {
  const { login, registerAccount } = useOtello();
  const [mode, setMode] = useState<"enter" | "create">("enter");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-serif text-6xl tracking-tight">otello</p>
      <p className="mt-4 text-sm leading-relaxed text-char">
        {mode === "enter" ? "Sign in to the workspace." : "Create an account. It can publish offers and request leases."}
      </p>
      <form
        className="mt-10 grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          const action = mode === "enter" ? login(name, password) : registerAccount(name, password);
          void action.then((result) => {
            setErrors(result.errors);
            setPending(false);
          });
        }}
      >
        <Field label="Name">
          <TextInput value={name} autoComplete="username" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Password">
          <TextInput type="password" value={password} autoComplete={mode === "enter" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <ErrorList errors={errors} />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking" : mode === "enter" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <button
        type="button"
        className="mt-6 text-left text-sm underline underline-offset-4"
        onClick={() => {
          setMode(mode === "enter" ? "create" : "enter");
          setErrors([]);
        }}
      >
        {mode === "enter" ? "Create an account" : "I already have an account"}
      </button>
      <div className="mt-12">
        <ContractAddress />
      </div>
    </main>
  );
}
