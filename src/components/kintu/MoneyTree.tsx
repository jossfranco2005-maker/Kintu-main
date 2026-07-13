// Money tree — SVG. Organic phyllotaxis canopy (golden-angle scatter),
// each leaf sways independently, whole tree breathes idle. Face reacts
// to savings ratio. Falling leaf still framed as feeding growth, never
// as loss. Minimum inner cluster of leaves NEVER falls.

import { useMemo, useEffect, useRef, useState } from "react";

const CORE_LEAVES = 6; // never fall
const MAX_LEAVES = 26;
const GOLDEN_ANGLE = (137.50776 * Math.PI) / 180;

function leafColor(_currency = "USD") {
  return "var(--color-leaf)";
}

// Deterministic pseudo-random per index — stable across re-renders
function seeded(i: number) {
  return Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
}

type Leaf = {
  x: number;
  y: number;
  r: number;
  rot: number;
  core: boolean;
  swayA: number;
  swayB: number;
  swayDur: number;
  swayDelay: number;
};

export function MoneyTree({
  netBalance,
  incomes,
  expenses,
}: {
  netBalance: number;
  incomes: number;
  expenses: number;
}) {
  const totalActivity = Math.max(1, incomes + expenses);
  const ratio = Math.max(0, Math.min(1, incomes / totalActivity));
  const leafCount = Math.max(
    CORE_LEAVES,
    Math.round(CORE_LEAVES + ratio * (MAX_LEAVES - CORE_LEAVES)),
  );

  const leaves = useMemo(() => {
    const arr: Leaf[] = [];
    const R = 44;
    for (let i = 0; i < leafCount; i++) {
      const theta = i * GOLDEN_ANGLE;
      const r = R * Math.sqrt(i / Math.max(1, leafCount));
      const x = 100 + r * Math.cos(theta);
      const y = 62 + r * Math.sin(theta) * 0.68;
      const size = 6 + seeded(i) * 4.5;
      const rot = (theta * 180) / Math.PI + (seeded(i + 50) * 30 - 15);
      arr.push({
        x,
        y,
        r: size,
        rot,
        core: i < CORE_LEAVES,
        swayA: -3 - seeded(i + 3) * 4,
        swayB: 3 + seeded(i + 7) * 4,
        swayDur: 2.6 + seeded(i + 11) * 2.2,
        swayDelay: seeded(i + 21) * 3,
      });
    }
    return arr;
  }, [leafCount]);

  // Mouth curve grows with savings ratio, slightly asymmetric (never inverts to frown)
  const mouthDepth = 9 + ratio * 10;

  const [spark, setSpark] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const prevBalance = useRef(netBalance);
  const prevLeafCount = useRef(leafCount);

  useEffect(() => {
    if (netBalance !== prevBalance.current) {
      setSpark(Date.now());
      const t = setTimeout(() => setSpark(null), 1200);
      prevBalance.current = netBalance;
      return () => clearTimeout(t);
    }
  }, [netBalance]);

  useEffect(() => {
    if (leafCount > prevLeafCount.current) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 950);
      prevLeafCount.current = leafCount;
      return () => clearTimeout(t);
    }
    prevLeafCount.current = leafCount;
  }, [leafCount]);

  return (
    <div
      className={`relative w-full max-w-[240px] mx-auto aspect-square ${
        celebrate ? "tree-celebrate" : "tree-idle"
      }`}
      style={{ transformOrigin: "50% 92%" }}
    >
      <svg viewBox="0 0 200 200" className="w-full h-full" aria-hidden>
        <line
          x1="20"
          y1="180"
          x2="180"
          y2="180"
          stroke="var(--color-clay)"
          strokeWidth="1"
          opacity="0.4"
        />
        <path
          d="M 100 180 Q 96 140 100 108 Q 104 88 100 68"
          stroke="var(--color-clay)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 128 Q 82 116 78 106"
          stroke="var(--color-clay)"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M 100 118 Q 118 106 124 98"
          stroke="var(--color-clay)"
          strokeWidth="2"
          fill="none"
        />
        {/* root flare */}
        <path
          d="M 92 179 Q 84 183 76 187"
          stroke="var(--color-clay)"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
        />
        <path
          d="M 108 179 Q 116 183 124 187"
          stroke="var(--color-clay)"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
        />
        <path
          d="M 100 180 Q 98 186 96 192"
          stroke="var(--color-clay)"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
        />

        {leaves.map((l, i) => (
          <g
            key={i}
            className="tree-leaf"
            style={
              {
                transformBox: "fill-box",
                transformOrigin: "center",
                "--sway-a": `${l.swayA}deg`,
                "--sway-b": `${l.swayB}deg`,
                animationDuration: `${l.swayDur}s`,
                animationDelay: `${l.swayDelay}s`,
              } as React.CSSProperties
            }
          >
            <ellipse
              cx={l.x}
              cy={l.y}
              rx={l.r}
              ry={l.r * 1.35}
              fill={leafColor()}
              opacity={l.core ? 0.95 : 0.85}
              transform={`rotate(${l.rot} ${l.x} ${l.y})`}
            />
            <line
              x1={l.x}
              y1={l.y - l.r * 1.1}
              x2={l.x}
              y2={l.y + l.r * 1.1}
              stroke="var(--color-ink)"
              strokeWidth="0.7"
              opacity="0.25"
              transform={`rotate(${l.rot} ${l.x} ${l.y})`}
            />
          </g>
        ))}

        {spark && (
          <>
            <circle
              cx="100"
              cy="180"
              r="3"
              fill="var(--color-gold)"
              style={{ animation: "spark 1.1s ease-out forwards" }}
            />
            {celebrate &&
              [0, 1, 2].map((k) => (
                <circle
                  key={k}
                  cx={leaves[leaves.length - 1]?.x ?? 100}
                  cy={leaves[leaves.length - 1]?.y ?? 62}
                  r="2"
                  fill="var(--color-gold)"
                  style={{ animation: `sparkle 1s ease-out ${k * 0.08}s forwards` }}
                />
              ))}
          </>
        )}

        {/* Face — expressive, never used as a pressure device */}
        <ellipse cx="86" cy="70" rx="6" ry="4.5" fill="var(--color-gold)" opacity="0.22" />
        <ellipse cx="114" cy="70" rx="6" ry="4.5" fill="var(--color-gold)" opacity="0.22" />
        <path
          d="M 82 56 Q 87 52 93 55"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M 107 55 Q 113 52 118 56"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.55"
        />
        <g className="tree-eye">
          <ellipse cx="87" cy="63" rx="4.2" ry="5.6" fill="var(--color-ink)" />
          <circle cx="85.5" cy="61" r="1.3" fill="var(--color-paper)" />
        </g>
        <g className="tree-eye" style={{ animationDelay: "0.15s" }}>
          <ellipse cx="113" cy="64" rx="4.6" ry="6" fill="var(--color-ink)" />
          <circle cx="111.5" cy="61.7" r="1.4" fill="var(--color-paper)" />
        </g>
        <path
          d={`M 89 78 Q 102 ${78 + mouthDepth} 111 77`}
          stroke="var(--color-ink)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </svg>

      <style>{`
        @keyframes spark {
          0% { cy: 180; opacity: 0; r: 2; }
          20% { opacity: 1; }
          100% { cy: 60; opacity: 0; r: 5; }
        }
        @keyframes sparkle {
          0% { transform: scale(0.3) translateY(0); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: scale(1) translateY(-24px); opacity: 0; }
        }
        @keyframes blink {
          0%, 90%, 100% { transform: scaleY(1); }
          94% { transform: scaleY(0.1); }
        }
        @keyframes idle {
          0% { transform: rotate(-1.4deg) scale(1); }
          50% { transform: rotate(1.4deg) scale(1.015); }
          100% { transform: rotate(-1.4deg) scale(1); }
        }
        @keyframes celebrate {
          0% { transform: translateY(0) rotate(-1.4deg) scale(1); }
          30% { transform: translateY(-14px) rotate(-7deg) scale(1.06); }
          55% { transform: translateY(0) rotate(6deg) scale(1); }
          75% { transform: translateY(-5px) rotate(-2deg) scale(1.03); }
          100% { transform: translateY(0) rotate(1.4deg) scale(1); }
        }
        @keyframes leafSway {
          0% { transform: rotate(var(--sway-a)); }
          50% { transform: rotate(var(--sway-b)); }
          100% { transform: rotate(var(--sway-a)); }
        }
        .tree-eye {
          transform-box: fill-box;
          transform-origin: center;
          animation: blink 5s ease-in-out infinite;
        }
        .tree-idle { animation: idle 6s ease-in-out infinite; }
        .tree-celebrate { animation: celebrate 0.9s ease-out; }
        .tree-leaf {
          animation-name: leafSway;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          circle, .tree-eye, .tree-idle, .tree-celebrate, .tree-leaf { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// "El hilo" — organic budget line
export function BudgetHilo({
  spent,
  limit,
  category,
}: {
  spent: number;
  limit: number;
  category: string;
}) {
  const pct = Math.max(0, Math.min(1.2, spent / limit));
  const remaining = Math.max(0, limit - spent);
  const milestone =
    pct >= 1
      ? `Cruzaste el mes en ${category}.`
      : pct >= 0.8
        ? `Te acercás al límite — quedan USD ${remaining.toFixed(0)}.`
        : pct >= 0.5
          ? `Vas por la mitad. Quedan USD ${remaining.toFixed(0)}.`
          : `Vas tranquilo. Quedan USD ${remaining.toFixed(0)}.`;

  const endX = 20 + pct * 260;
  const overLimit = pct > 1;

  const [glow, setGlow] = useState(false);
  const prevTier = useRef<number>(-1);

  useEffect(() => {
    const tier = pct >= 1 ? 3 : pct >= 0.8 ? 2 : pct >= 0.5 ? 1 : 0;
    if (prevTier.current === -1) {
      prevTier.current = tier;
      return;
    }
    if (tier > prevTier.current) {
      setGlow(true);
      const t = setTimeout(() => setGlow(false), 1000);
      prevTier.current = tier;
      return () => clearTimeout(t);
    }
    prevTier.current = tier;
  }, [pct]);

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-muted-foreground capitalize">{category}</span>
        <span className="tabular text-xs text-muted-foreground">
          USD {spent.toFixed(0)} / {limit.toFixed(0)}
        </span>
      </div>
      <svg viewBox="0 0 300 40" className="w-full h-8" aria-hidden>
        <path
          d="M 20 20 Q 100 12, 180 22 T 280 20"
          stroke="var(--color-hairline)"
          strokeWidth="1.5"
          fill="none"
          strokeDasharray="2 3"
        />
        <path
          d={`M 20 20 Q ${Math.min(endX, 100)} 12, ${Math.min(endX, 180)} 22 T ${endX} 20`}
          stroke={overLimit ? "var(--color-coral)" : "var(--color-leaf)"}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle
          cx={endX}
          cy="20"
          r="3.5"
          fill={overLimit ? "var(--color-coral)" : "var(--color-leaf)"}
        />
      </svg>
      <p className="text-xs text-muted-foreground mt-1">{milestone}</p>
      <style>{`
        @keyframes hiloGlow {
          0% { r: 3.5; opacity: 1; }
          100% { r: 12; opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          circle[stroke="var(--color-gold)"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
