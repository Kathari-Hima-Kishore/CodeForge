import { CodeXml } from "lucide-react";

export function Logo() {
  return (
    <div className="flex items-center gap-3.5">
      <div className="relative">
        <div className="absolute inset-0 bg-white/20 rounded-xl blur-sm" />
        <CodeXml className="h-9 w-9 text-white relative z-10" />
      </div>
      <h1 className="text-xl font-black tracking-[0.2em] text-white font-headline">
        CODEFORGE
      </h1>
    </div>
  );
}
