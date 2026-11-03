import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Crosshair, KanbanSquare, MapPin, MessageSquareText } from "lucide-react";

const features = [
  { icon: MapPin, title: "Leads do Google Maps", text: "Encontre empresas por nicho e região, com filtro de site informado." },
  { icon: KanbanSquare, title: "CRM visual", text: "Acompanhe cada oportunidade do primeiro contato ao fechamento." },
  { icon: MessageSquareText, title: "Abordagem responsável", text: "Mensagens revisadas por você, com limites e opt-out." },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0F172A] p-12 text-white lg:flex lg:flex-col">
        <motion.div
          aria-hidden
          className="absolute -left-32 -top-32 size-[520px] rounded-full bg-[#6366F1]/30 blur-[120px]"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-40 right-0 size-[460px] rounded-full bg-[#8B5CF6]/25 blur-[120px]"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] shadow-lg shadow-indigo-500/40">
            <Crosshair className="size-4.5" />
          </div>
          <span className="font-semibold">LeadHunter Pro</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-4xl font-semibold leading-[1.1] tracking-tight"
          >
            Prospecção comercial{" "}
            <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">organizada</span>, do
            mapa ao contrato.
          </motion.h2>
          <ul className="mt-10 space-y-5">
            {features.map((f, i) => (
              <motion.li
                key={f.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.12, duration: 0.5 }}
                className="flex gap-4"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                  <f.icon className="size-4.5 text-indigo-300" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{f.text}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6]">
              <Crosshair className="size-4.5 text-white" />
            </div>
            <span className="font-semibold">LeadHunter Pro</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}
