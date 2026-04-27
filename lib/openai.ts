// Legacy entrypoint preserved for existing callers.
//
// The real implementation moved to lib/embeddings.ts with provider-agnostic
// dispatch (OpenAI default, Voyage + Cohere stubs for v2.1). New code should
// import from @/lib/embeddings directly.

export { embedText, embedMany, EMBED_DIMS } from './embeddings';
