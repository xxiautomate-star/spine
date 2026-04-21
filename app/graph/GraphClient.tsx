'use client';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

type EntityType = 'person' | 'project' | 'tool' | 'concept' | 'decision';

type Node = {
  id: string;
  name: string;
  type: EntityType;
  mention_count: number;
  last_seen: string;
  // d3-force adds these:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type Edge = {
  id: string;
  from_node: string;
  to_node: string;
  edge_type: 'MENTIONED_IN' | 'RELATED_TO' | 'SUPERSEDES';
  weight: number;
  // d3-force adds these:
  source?: Node | string;
  target?: Node | string;
};

type GraphData = { nodes: Node[]; edges: Edge[] };

// ── Colors ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<EntityType, string> = {
  person:   '#E89A3C',  // amber
  project:  '#4A5E7A',  // ink blue
  tool:     '#6B7FFF',  // lavender
  concept:  '#7AB3A0',  // teal
  decision: '#C084FC',  // violet
};

const TYPE_LABELS: Record<EntityType, string> = {
  person:   'Person',
  project:  'Project',
  tool:     'Tool',
  concept:  'Concept',
  decision: 'Decision',
};

const EDGE_COLORS: Record<string, string> = {
  RELATED_TO:   'rgba(232,228,221,0.06)',
  MENTIONED_IN: 'rgba(232,228,221,0.04)',
  SUPERSEDES:   'rgba(232,154,60,0.20)',
};

// ── d3-force simulation (loaded dynamically) ──────────────────────────────

type D3Force = {
  forceSimulation: (nodes: Node[]) => D3Simulation;
};

type D3Simulation = {
  force: (name: string, force: unknown) => D3Simulation;
  on: (event: string, cb: () => void) => D3Simulation;
  tick: () => void;
  stop: () => void;
  alpha: (v?: number) => number | D3Simulation;
  alphaTarget: (v: number) => D3Simulation;
  restart: () => D3Simulation;
  nodes: (nodes?: Node[]) => Node[] | D3Simulation;
};

// ── Canvas graph renderer ──────────────────────────────────────────────────

function nodeRadius(n: Node): number {
  return Math.max(5, Math.min(22, 5 + Math.sqrt(n.mention_count) * 2.8));
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  edges: Edge[],
  hovered: Node | null,
  selected: Node | null,
  dpr: number
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Edges.
  for (const e of edges) {
    const src = typeof e.source === 'object' ? (e.source as Node) : null;
    const tgt = typeof e.target === 'object' ? (e.target as Node) : null;
    if (!src || !tgt || src.x == null || tgt.x == null) continue;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y ?? 0);
    ctx.lineTo(tgt.x, tgt.y ?? 0);
    const isHighlighted =
      hovered != null && (src.id === hovered.id || tgt.id === hovered.id);
    ctx.strokeStyle = isHighlighted
      ? 'rgba(232,154,60,0.35)'
      : (EDGE_COLORS[e.edge_type] ?? 'rgba(232,228,221,0.05)');
    ctx.lineWidth = isHighlighted ? 1.5 * dpr : 0.8 * dpr;
    ctx.stroke();
  }

  // Nodes.
  for (const n of nodes) {
    if (n.x == null) continue;
    const r = nodeRadius(n) * dpr;
    const color = TYPE_COLORS[n.type] ?? '#E8E4DD';
    const isActive = hovered?.id === n.id || selected?.id === n.id;

    // Glow.
    if (isActive) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20 * dpr;
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y ?? 0, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? color : color + '99';
    ctx.fill();

    if (isActive) ctx.restore();

    // Label.
    if (isActive || n.mention_count >= 3) {
      ctx.fillStyle = isActive ? '#E8E4DD' : 'rgba(232,228,221,0.55)';
      ctx.font = `${isActive ? 700 : 400} ${Math.max(9, Math.min(12, r * 0.9))}px "Courier New"`;
      ctx.textAlign = 'center';
      ctx.fillText(
        n.name.length > 18 ? n.name.slice(0, 16) + '…' : n.name,
        n.x,
        (n.y ?? 0) + r + 10 * dpr
      );
    }
  }
}

// ── Main component ────────────────────────────────────────────────────────

export function GraphClient({ email }: { email: string }) {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Node | null>(null);
  const [selected, setSelected] = useState<Node | null>(null);
  const [filter, setFilter] = useState<EntityType | 'all'>('all');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<D3Simulation | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const hoveredRef = useRef<Node | null>(null);
  const selectedRef = useRef<Node | null>(null);

  // Fetch graph data.
  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json())
      .then((data: GraphData | { error?: string }) => {
        if ('error' in data && data.error) {
          setError(data.error);
        } else {
          const d = data as GraphData;
          setGraph(d);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Trigger entity extraction if graph is empty.
  function triggerExtraction() {
    fetch('/api/entity/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_n: 50 }),
    })
      .then(() => window.location.reload())
      .catch(() => null);
  }

  const filteredNodes = filter === 'all'
    ? graph.nodes
    : graph.nodes.filter((n) => n.type === filter);
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = graph.edges.filter(
    (e) => {
      const srcId = typeof e.source === 'object' ? (e.source as Node).id : e.from_node;
      const tgtId = typeof e.target === 'object' ? (e.target as Node).id : e.to_node;
      return filteredNodeIds.has(srcId) && filteredNodeIds.has(tgtId);
    }
  );

  // Initialise/update simulation when data changes.
  useEffect(() => {
    if (filteredNodes.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Assign initial positions.
    const simNodes: Node[] = filteredNodes.map((n) => ({
      ...n,
      x: n.x ?? W / 2 + (Math.random() - 0.5) * 200,
      y: n.y ?? H / 2 + (Math.random() - 0.5) * 200,
    }));

    const simEdges: Edge[] = filteredEdges.map((e) => ({
      ...e,
      source: e.from_node,
      target: e.to_node,
    }));

    nodesRef.current = simNodes;
    edgesRef.current = simEdges;

    // Dynamic d3-force import.
    import('d3-force')
      .then((d3) => {
        simRef.current?.stop();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = d3;
        const linkForce = d.forceLink(simEdges)
          .id((n: unknown) => (n as Node).id)
          .distance(80)
          .strength(0.3);

        const sim: D3Simulation = d.forceSimulation(simNodes)
          .force('link', linkForce)
          .force('charge', d.forceManyBody().strength(-180))
          .force('center', d.forceCenter(W / 2, H / 2))
          .force('collide', d.forceCollide().radius((n: unknown) => nodeRadius(n as Node) + 8));

        sim.on('tick', () => {
          drawGraph(ctx, nodesRef.current, edgesRef.current, hoveredRef.current, selectedRef.current, dpr);
        });

        simRef.current = sim;
      })
      .catch(() => {
        // d3-force not available — draw static.
        drawGraph(ctx, simNodes, simEdges, null, null, dpr);
      });

    return () => simRef.current?.stop();
  }, [filteredNodes.length, filteredEdges.length, filter]); // eslint-disable-line

  // Mouse interaction.
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let hit: Node | null = null;
    for (const n of nodesRef.current) {
      if (n.x == null) continue;
      const r = nodeRadius(n);
      const dx = n.x - x;
      const dy = (n.y ?? 0) - y;
      if (dx * dx + dy * dy < r * r * 1.5) { hit = n; break; }
    }

    hoveredRef.current = hit;
    setHovered(hit);
    if (canvas) canvas.style.cursor = hit ? 'pointer' : 'default';
  }, []);

  const handleClick = useCallback(() => {
    selectedRef.current = hoveredRef.current;
    setSelected(hoveredRef.current);
  }, []);

  // Drag to pin node.
  const dragging = useRef<Node | null>(null);

  const handleMouseDown = useCallback(() => {
    dragging.current = hoveredRef.current;
    if (dragging.current) {
      dragging.current.fx = dragging.current.x;
      dragging.current.fy = dragging.current.y;
      simRef.current?.alphaTarget(0.3).restart();
    }
  }, []);

  const handleMouseDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragging.current.fx = e.clientX - rect.left;
    dragging.current.fy = e.clientY - rect.top;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (dragging.current) {
      dragging.current.fx = null;
      dragging.current.fy = null;
    }
    dragging.current = null;
    simRef.current?.alphaTarget(0);
  }, []);

  const typeCounts: Partial<Record<EntityType, number>> = {};
  for (const n of graph.nodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }

  return (
    <>
      {/* Atmosphere */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-amber/[0.04] blur-[200px]" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/75 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/timeline" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Timeline</Link>
          <Link href="/ask" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Ask</Link>
          <span className="text-cream/22 hidden md:block">{email}</span>
        </div>
      </header>

      <div className="relative flex h-[calc(100vh-73px)]">
        {/* Left sidebar */}
        <aside className="w-60 flex-shrink-0 border-r border-cream/[0.06] p-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest text-amber/55 mb-3">Entity graph</p>
            <p className="font-serif text-2xl text-cream/85 leading-tight">
              {graph.nodes.length} entities
            </p>
            <p className="font-mono text-[10px] text-cream/25 mt-1">
              {graph.edges.length} connections
            </p>
          </div>

          {/* Type filters */}
          <div className="space-y-1 pt-2 border-t border-cream/[0.06]">
            <p className="font-mono text-[9px] uppercase tracking-widest text-cream/25 mb-2">Filter</p>
            {(['all', 'person', 'project', 'tool', 'concept', 'decision'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                  filter === t
                    ? 'bg-cream/[0.06] text-cream/80'
                    : 'text-cream/35 hover:text-cream/60 hover:bg-cream/[0.03]'
                }`}
              >
                {t !== 'all' && (
                  <span
                    className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                    style={{ background: TYPE_COLORS[t as EntityType] }}
                  />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {t === 'all' ? 'All' : TYPE_LABELS[t as EntityType]}
                </span>
                {t !== 'all' && (
                  <span className="ml-auto font-mono text-[9px] text-cream/25">
                    {typeCounts[t as EntityType] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Selected node info */}
          {selected && (
            <div className="pt-3 border-t border-cream/[0.06] space-y-2">
              <p className="font-mono text-[9px] uppercase tracking-widest text-cream/25">Selected</p>
              <div
                className="w-[8px] h-[8px] rounded-full"
                style={{ background: TYPE_COLORS[selected.type] }}
              />
              <p className="text-cream/85 text-sm font-medium">{selected.name}</p>
              <p className="font-mono text-[10px] text-cream/35">
                {TYPE_LABELS[selected.type]} · {selected.mention_count}×
              </p>
              <p className="font-mono text-[9px] text-cream/20">
                {new Date(selected.last_seen).toLocaleDateString()}
              </p>
              <button
                onClick={() => setSelected(null)}
                className="font-mono text-[9px] uppercase tracking-wider text-cream/25 hover:text-cream/50 transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="mt-auto pt-4 border-t border-cream/[0.05] space-y-2">
            <p className="font-mono text-[9px] uppercase tracking-widest text-cream/20 mb-1">Legend</p>
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="font-mono text-[9px] text-cream/30 capitalize">{type}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <span className="w-5 h-px bg-amber/30 flex-shrink-0" />
              <span className="font-mono text-[9px] text-cream/20">Supersedes</span>
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="font-mono text-[11px] uppercase tracking-widest text-cream/25 animate-pulse">
                Loading graph…
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="font-mono text-[11px] text-amber/50">{error}</p>
            </div>
          )}

          {!loading && !error && graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
              <p className="font-serif italic text-2xl text-cream/25">
                No entities yet.
              </p>
              <p className="font-mono text-[11px] text-cream/18 max-w-xs">
                Spine extracts entities from your memories automatically. Use Claude Code for a few minutes then come back — or trigger extraction now.
              </p>
              <button
                onClick={triggerExtraction}
                className="font-mono text-[10px] uppercase tracking-widest text-amber/60 hover:text-amber border-b border-amber/25 hover:border-amber/60 pb-[1px] transition-all duration-300"
              >
                Extract from last 50 memories →
              </button>
            </div>
          )}

          {!loading && graph.nodes.length > 0 && (
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              onMouseMove={(e) => {
                handleMouseMove(e);
                handleMouseDrag(e);
              }}
              onClick={handleClick}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          )}

          {/* Hover tooltip */}
          {hovered && !dragging.current && (
            <div
              className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-night/90 border border-cream/[0.1] rounded-lg backdrop-blur-sm"
            >
              <p className="font-mono text-[10px] text-cream/70">
                <span style={{ color: TYPE_COLORS[hovered.type] }}>{hovered.name}</span>
                <span className="text-cream/30 mx-1.5">·</span>
                {TYPE_LABELS[hovered.type]}
                <span className="text-cream/30 mx-1.5">·</span>
                {hovered.mention_count}× mentioned
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
