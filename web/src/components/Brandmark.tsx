import Link from "next/link";

export function Brandmark() {
  return (
    <Link href="/" className="text-lg font-bold tracking-tight">
      <div className="flex items-center text-[18px] font-bold tracking-[-0.02em]">
        <span
          className="h-[10px] w-[10px] rounded-full bg-primary mr-2"
          aria-hidden="true"
        />
        dontcancel<span className="text-primary">.me</span>
      </div>
    </Link>
  );
}
