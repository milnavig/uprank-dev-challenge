export default function Loading() {
  return <main className="loading-shell" aria-busy="true" aria-label="Loading dashboard"><div className="loading-brand">UpRank<span>.</span></div><div role="status"><div className="loading-indicator" /><h1>Loading dashboard</h1><p>Reading the latest complete snapshot.</p></div><div className="loading-skeletons" aria-hidden="true"><div /><div /><div /></div></main>;
}
