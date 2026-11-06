import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <span className="num text-xs tracking-[0.2em] text-lime">404</span>
      <h1 className="text-2xl font-semibold">Nothing here</h1>
      <Link href="/trenches" className="btn-lime">
        Back to Hunt
      </Link>
    </div>
  );
}
