"use client";

import Link from "next/link";

type Tab = "chat" | "team" | "admin" | "menu";

type Props = {
  activeTab: Tab;
  onMenuPress: () => void;
  showAdmin?: boolean;
  locale: "en" | "ar";
};

export function MobileBottomNav({
  activeTab,
  onMenuPress,
  showAdmin = false,
  locale,
}: Props) {
  const isAr = locale === "ar";

  const tabClass = (tab: Tab) =>
    `flex flex-col items-center gap-1 rounded-xl px-3 py-2.5 transition-all duration-200 ${
      activeTab === tab
        ? "text-indigo-400"
        : "text-slate-400 hover:text-slate-200 active:bg-white/5"
    }`;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main navigation"
    >
      <div className="mobile-bottom-nav flex w-full items-center justify-around px-3 pt-2 pb-1">
        <Link href="/" className={tabClass("chat")}>
          <ChatIcon className="h-5 w-5" />
          <span className="text-[11px] font-medium">
            {isAr ? "المحادثة" : "Chat"}
          </span>
        </Link>

        <Link href="/team" className={tabClass("team")}>
          <TeamIcon className="h-5 w-5" />
          <span className="text-[11px] font-medium">
            {isAr ? "الفريق" : "Team"}
          </span>
        </Link>

        {showAdmin && (
          <Link href="/admin" className={tabClass("admin")}>
            <ChartIcon className="h-5 w-5" />
            <span className="text-[11px] font-medium">
              {isAr ? "التحليلات" : "Admin"}
            </span>
          </Link>
        )}

        <button
          type="button"
          onClick={onMenuPress}
          className={tabClass("menu")}
          aria-label={isAr ? "القائمة" : "Menu"}
        >
          <MenuIcon className="h-5 w-5" />
          <span className="text-[11px] font-medium">
            {isAr ? "القائمة" : "Menu"}
          </span>
        </button>
      </div>
    </nav>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

function TeamIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}
