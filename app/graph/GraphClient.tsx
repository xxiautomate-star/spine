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
  // Decision-only payload — the route fills these in for type='decision'
  // nodes so hover / select / share can show the full statement instead of
  // just the truncated label.
  statement?: string;
  confidence?: number;
  status?: 'active' | 'superseded' | 'reverted' | 'pending_review';
  source_memory_id?: string | null;
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
  edge_type: 'MENTIONED_IN' | 'RELATED_TO' | 'SUPERSEDES' | 'DECIDES_ABOUT';
  weight: number;
  // d3-force adds these:
  source?: Node | string;
  target?: Node | string;
};

type GraphData = { nodes: Node[]; edges: Edge[] };

type MergeProposal = {
  id: string;
  similarity: number;
  node_a: { id: string; name: string; type: string };
  node_b: { id: string; name: string; type: string };
};

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
  RELATED_TO:    'rgba(232,228,221,0.06)',
  MENTIONED_IN:  'rgba(232,228,221,0.04)',
  SUPERSEDES:    'rgba(232,154,60,0.20)',
  // Decisions are connected to the entities they decide about. Slightly
  // brighter than RELATED_TO so the eye picks up the violet→entity bridges
  // as the spine of the constellation rather than incidental wiring.
  DECIDES_ABOUT: 'rgba(192,132,252,0.18)',
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
  // Decision nodes are ~30% larger by default so the diamond shape reads
  // immediately as something distinct in the constellation. They are
  // semantically "headlines" — the few decisions on the canvas should be
  // visually-louder than the dozens of entities around them.
  const base = Math.max(5, Math.min(22, 5 + Math.sqrt(n.mention_count) * 2.8));
  return n.type === 'decision' ? base * 1.3 : base;
}

// Draws a four-corner diamond (square rotated 45°) instead of a circle. Used
// for decision nodes so they read as a different category at a glance.
function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
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

    if (n.type === 'decision') {
      drawDiamond(ctx, n.x, n.y ?? 0, r);
    } else {
      ctx.beginPath();
      ctx.arc(n.x, n.y ?? 0, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = isActive ? color : color + '99';
    ctx.fill();

    // Decisions get an extra subtle stroke so the diamond outline is
    // legible even at small sizes — circles are unambiguous at any radius;
    // diamonds need the edges to stay distinct.
    if (n.type === 'decision') {
      ctx.strokeStyle = isActive ? color : 'rgba(192,132,252,0.5)';
      ctx.lineWidth = (isActive ? 1.5 : 1) * dpr;
      ctx.stroke();
    }

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
  const [proposals, setProposals] = useState<MergeProposal[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [sharing, setSharing] = useState<'idle' | 'generating' | 'done'>('idle');
  const [revealed, setRevealed] = useState(false); // cinematic fade-in

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<D3Simulation | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const hoveredRef = useRef<Node | null>(null);
  const selectedRef = useRef<Node | null>(null);

  // Fetch graph data + merge proposals + usage in parallel. The usage call
  // gives us the memory count for the share card — without it the stats
  // overlay can show only entity/connection counts.
  useEffect(() => {
    Promise.all([
      fetch('/api/graph').then((r) => r.json()),
      fetch('/api/entity/proposals').then((r) => r.json()),
      fetch('/api/usage').then((r) => r.json()).catch(() => ({ memoryCount: null })),
    ])
      .then(([graphData, proposalData, usage]: [
        GraphData | { error?: string },
        { proposals?: MergeProposal[] },
        { memoryCount?: number | null },
      ]) => {
        if ('error' in graphData && graphData.error) {
          setError(graphData.error as string);
        } else {
          setGraph(graphData as GraphData);
        }
        setProposals(proposalData.proposals ?? []);
        if (typeof usage.memoryCount === 'number') setMemoryCount(usage.memoryCount);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Reveal the canvas with a slow fade once data lands. Tiny detail, but it's
  // what makes the constellation feel like it's *forming* rather than
  // popping into existence — the difference between "screenshot fodder"
  // and "another data viz."
  useEffect(() => {
    if (loading) return;
    if (graph.nodes.length === 0) return;
    const t = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(t);
  }, [loading, graph.nodes.length]);

  async function handleMerge(proposal: MergeProposal, survivorId: string) {
    setMergingId(proposal.id);
    try {
      await fetch('/api/entity/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposal.id, survivor_id: survivorId }),
      });
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
      // Refresh graph
      const data = (await fetch('/api/graph').then((r) => r.json())) as GraphData;
      setGraph(data);
    } catch {
      // noop
    } finally {
      setMergingId(null);
    }
  }

  async function handleDismissProposal(proposalId: string) {
    // Mark dismissed server-side by resolving with both nodes surviving
    await fetch('/api/entity/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal_id: proposalId, undo: true }),
    }).catch(() => null);
    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
  }

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

  // Render the on-screen canvas onto a 1200×1200 share canvas with the stats
  // strip and watermark composited in. Returns a data URL the caller can
  // hand to <a download> to trigger a save without leaving the page.
  const buildShareImage = useCallback((): string | null => {
    const live = canvasRef.current;
    if (!live) return null;

    const SIZE = 1200;
    const off = document.createElement('canvas');
    off.width = SIZE;
    off.height = SIZE;
    const ctx = off.getContext('2d');
    if (!ctx) return null;

    // Background. The radial vignette mirrors the night/amber palette of the
    // app — keeps the share image consistent with what people will see when
    // they click through to spine.xxiautomate.com.
    ctx.fillStyle = '#0D0C0A';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const vignette = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.15, SIZE / 2, SIZE / 2, SIZE * 0.7);
    vignette.addColorStop(0, 'rgba(232,154,60,0.06)');
    vignette.addColorStop(1, 'rgba(13,12,10,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // The graph itself, scaled and centred. We draw the live canvas (which
    // already has the simulation rendered) into a 1024×1024 region with
    // 88px of breathing room top + bottom for the title and watermark.
    const GRAPH_PAD = 88;
    const GRAPH_BOX = SIZE - GRAPH_PAD * 2;
    ctx.drawImage(live, GRAPH_PAD, GRAPH_PAD, GRAPH_BOX, GRAPH_BOX);

    // Title — Instrument Serif via system fallback (canvas can't load web
    // fonts on demand, so we lean on a serif stack that approximates).
    ctx.fillStyle = '#E8E4DD';
    ctx.font = 'italic 56px "Instrument Serif", "Iowan Old Style", "Apple Garamond", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('My Spine.', SIZE / 2, 48);

    // Stats strip at the bottom — three numbers, monospaced, amber accent
    // ahead of each. Reads as a footer ribbon under the constellation.
    const statY = SIZE - 96;
    ctx.font = '18px "JetBrains Mono", "Courier New", monospace';
    ctx.fillStyle = 'rgba(232,228,221,0.55)';
    ctx.textBaseline = 'middle';

    const stats: Array<{ n: string | null; label: string }> = [
      { n: memoryCount != null ? memoryCount.toLocaleString() : null, label: 'memories' },
      { n: graph.nodes.length.toLocaleString(), label: 'entities' },
      { n: graph.edges.length.toLocaleString(), label: 'connections' },
    ].filter((s) => s.n !== null) as Array<{ n: string; label: string }>;

    const visible = stats.filter((s): s is { n: string; label: string } => s.n != null);
    const COL = SIZE / (visible.length + 1);
    visible.forEach((s, i) => {
      const x = COL * (i + 1);
      ctx.fillStyle = '#E89A3C';
      ctx.font = '600 36px "Instrument Serif", "Iowan Old Style", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.n, x, statY - 12);
      ctx.fillStyle = 'rgba(232,228,221,0.4)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(s.label.toUpperCase(), x, statY + 22);
    });

    // Watermark.
    ctx.fillStyle = 'rgba(232,228,221,0.3)';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPINE.XXIAUTOMATE.COM', SIZE / 2, SIZE - 28);

    return off.toDataURL('image/png');
  }, [graph.nodes.length, graph.edges.length, memoryCount]);

  const handleShare = useCallback(async () => {
    if (sharing === 'generating') return;
    setSharing('generating');
    try {
      const url = buildShareImage();
      if (!url) {
        setSharing('idle');
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `spine-constellation-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSharing('done');
      setTimeout(() => setSharing('idle'), 1800);
    } catch {
      setSharing('idle');
    }
  }, [buildShareImage, sharing]);

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
                    className={`w-[6px] h-[6px] flex-shrink-0 ${t === 'decision' ? 'rotate-45' : 'rounded-full'}`}
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
              {selected.type === 'decision' ? (
                <span
                  className="inline-block w-[10px] h-[10px] rotate-45"
                  style={{ background: TYPE_COLORS[selected.type] }}
                />
              ) : (
                <div
                  className="w-[8px] h-[8px] rounded-full"
                  style={{ background: TYPE_COLORS[selected.type] }}
                />
              )}
              {selected.type === 'decision' && selected.statement ? (
                <>
                  <p className="font-serif text-base text-cream/90 leading-snug">
                    {selected.statement}
                  </p>
                  <p className="font-mono text-[10px] text-cream/35">
                    {TYPE_LABELS[selected.type]} · {selected.mention_count} link{selected.mention_count === 1 ? '' : 's'}
                    {selected.confidence != null && (
                      <> · {Math.round(selected.confidence * 100)}% conf</>
                    )}
                    {selected.status && selected.status !== 'active' && (
                      <> · {selected.status}</>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-cream/85 text-sm font-medium">{selected.name}</p>
                  <p className="font-mono text-[10px] text-cream/35">
                    {TYPE_LABELS[selected.type]} · {selected.mention_count}×
                  </p>
                </>
              )}
              <p className="font-mono text-[9px] text-cream/20">
                {new Date(selected.last_seen).toLocaleDateString()}
              </p>
              {selected.type === 'decision' && (
                <Link
                  href="/dashboard/decisions"
                  className="font-mono text-[9px] uppercase tracking-wider text-amber/55 hover:text-amber transition-colors duration-300 border-b border-amber/20 hover:border-amber/50 pb-[1px]"
                >
                  Open in decisions →
                </Link>
              )}
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
                <span
                  className={`w-[5px] h-[5px] flex-shrink-0 ${type === 'decision' ? 'rotate-45' : 'rounded-full'}`}
                  style={{ background: color }}
                />
                <span className="font-mono text-[9px] text-cream/30 capitalize">
                  {type}
                  {type === 'decision' && <span className="text-cream/15 ml-1">◆</span>}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <span className="w-5 h-px bg-amber/30 flex-shrink-0" />
              <span className="font-mono text-[9px] text-cream/20">Supersedes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-px flex-shrink-0" style={{ background: 'rgba(192,132,252,0.45)' }} />
              <span className="font-mono text-[9px] text-cream/20">Decides about</span>
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative flex flex-col">
          {/* Merge proposal banners */}
          {proposals.length > 0 && (
            <div className="flex-shrink-0 border-b border-cream/[0.06] max-h-48 overflow-y-auto">
              {proposals.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-5 py-3 text-[11px] border-b border-cream/[0.04] last:border-0"
                >
                  <span className="font-mono text-cream/25 flex-shrink-0 text-[9px] uppercase tracking-wider">
                    {Math.round(p.similarity * 100)}% match
                  </span>
                  <span className="text-cream/60 truncate flex-1">
                    <span className="text-amber/80">{p.node_a.name}</span>
                    <span className="text-cream/25 mx-1.5">≈</span>
                    <span className="text-amber/80">{p.node_b.name}</span>
                    <span className="text-cream/25 mx-1.5">·</span>
                    <span className="text-cream/30 capitalize">{p.node_a.type}</span>
                  </span>
                  <button
                    disabled={mergingId === p.id}
                    onClick={() => handleMerge(p, p.node_a.id)}
                    className="flex-shrink-0 font-mono text-[9px] uppercase tracking-wider text-amber/55 hover:text-amber transition-colors duration-200 disabled:opacity-40"
                  >
                    Keep {p.node_a.name}
                  </button>
                  <button
                    disabled={mergingId === p.id}
                    onClick={() => handleMerge(p, p.node_b.id)}
                    className="flex-shrink-0 font-mono text-[9px] uppercase tracking-wider text-amber/55 hover:text-amber transition-colors duration-200 disabled:opacity-40"
                  >
                    Keep {p.node_b.name}
                  </button>
                  <button
                    onClick={() => handleDismissProposal(p.id)}
                    className="flex-shrink-0 font-mono text-[9px] text-cream/20 hover:text-cream/40 transition-colors duration-200"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
              {proposals.length > 5 && (
                <p className="px-5 py-2 font-mono text-[9px] text-cream/20">
                  +{proposals.length - 5} more similar entities
                </p>
              )}
            </div>
          )}

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
              className="w-full h-full transition-opacity duration-[1400ms] ease-out"
              style={{ opacity: revealed ? 1 : 0 }}
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

          {/* Stats ribbon — top-right, fades in with the canvas. Reads as
              part of the constellation, not part of the chrome. The numbers
              here are what people screenshot. */}
          {!loading && graph.nodes.length > 0 && (
            <div
              className="pointer-events-none absolute top-5 right-5 flex items-end gap-6 transition-opacity duration-[1400ms] ease-out"
              style={{ opacity: revealed ? 1 : 0 }}
              aria-hidden
            >
              {memoryCount != null && (
                <Stat n={memoryCount.toLocaleString()} label="memories" />
              )}
              <Stat n={graph.nodes.length.toLocaleString()} label="entities" />
              <Stat n={graph.edges.length.toLocaleString()} label="connections" />
            </div>
          )}

          {/* Share button — bottom-right floater. Single press → PNG download.
              The whole point of the visual upgrade. */}
          {!loading && graph.nodes.length > 0 && (
            <button
              type="button"
              onClick={handleShare}
              disabled={sharing === 'generating'}
              className={`absolute bottom-5 right-5 group flex items-center gap-2.5 px-4 py-3 rounded-lg border backdrop-blur-md transition-all duration-300 ${
                sharing === 'done'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                  : 'border-amber/40 bg-night/70 hover:bg-amber/[0.08] text-amber'
              } disabled:opacity-60`}
              title="Download a 1200×1200 PNG of your constellation"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest">
                {sharing === 'generating'
                  ? 'Rendering…'
                  : sharing === 'done'
                  ? 'Saved'
                  : 'Share constellation'}
              </span>
              <span className="text-[14px] leading-none transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden>
                {sharing === 'done' ? '✓' : '↓'}
              </span>
            </button>
          )}


          {/* Hover tooltip — for decisions we show the full statement so a
              passing hover is enough to read what was decided without
              committing to a click. */}
          {hovered && !dragging.current && (
            <div
              className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 max-w-md px-4 py-2.5 bg-night/90 border border-cream/[0.1] rounded-lg backdrop-blur-sm"
            >
              {hovered.type === 'decision' && hovered.statement ? (
                <>
                  <p className="font-serif text-sm text-cream/90 leading-snug mb-1">
                    {hovered.statement}
                  </p>
                  <p className="font-mono text-[10px] text-cream/45">
                    <span style={{ color: TYPE_COLORS[hovered.type] }}>Decision</span>
                    <span className="text-cream/30 mx-1.5">·</span>
                    {hovered.mention_count} link{hovered.mention_count === 1 ? '' : 's'}
                    {hovered.confidence != null && (
                      <>
                        <span className="text-cream/30 mx-1.5">·</span>
                        {Math.round(hovered.confidence * 100)}% conf
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p className="font-mono text-[10px] text-cream/70">
                  <span style={{ color: TYPE_COLORS[hovered.type] }}>{hovered.name}</span>
                  <span className="text-cream/30 mx-1.5">·</span>
                  {TYPE_LABELS[hovered.type]}
                  <span className="text-cream/30 mx-1.5">·</span>
                  {hovered.mention_count}× mentioned
                </p>
              )}
            </div>
          )}
          </div>{/* end flex-1 relative inner */}
        </div>
      </div>
    </>
  );
}

// Stats ribbon item — large amber number on top, mono label below. Used by
// the in-canvas overlay; the share-PNG path renders the same content via
// canvas drawing primitives in buildShareImage.
function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="font-serif text-3xl text-amber tabular-nums">{n}</span>
      <span className="font-mono text-[9px] uppercase tracking-widest text-cream/35 mt-1">
        {label}
      </span>
    </div>
  );
}
