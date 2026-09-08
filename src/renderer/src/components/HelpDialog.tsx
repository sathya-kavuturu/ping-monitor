import Modal from './Modal'

interface HelpDialogProps {
  onClose: () => void
}

/**
 * Opened by the "?" button fixed at the top of the window (see `App`) - the
 * one help entry point available from every view, since there's no single
 * shared top nav bar to hang it on otherwise.
 */
function HelpDialog({ onClose }: HelpDialogProps): React.JSX.Element {
  return (
    <Modal title="How to use Ping Monitor" onClose={onClose} className="modal-card--wide">
      <div className="help-content">
        <section>
          <h3>Sidebar</h3>
          <ul>
            <li>
              <strong>Overview</strong> and <strong>Alerts</strong> are always-available views;
              everything else in the list is a monitored target - click one to see its detail page.
            </li>
            <li>
              <strong>+ Add Target</strong> opens a dialog for a name and a host (an IP address or a
              DNS name - it shows the IP it'll actually ping as you type).
            </li>
            <li>Right-click a target to edit or delete it.</li>
            <li>The collapse button (top-left) hides the sidebar to reclaim screen space.</li>
          </ul>
        </section>

        <section>
          <h3>A target's detail page</h3>
          <ul>
            <li>
              The stat cards up top show the current latency, hop count, and how long ago the path
              (traceroute) was last captured.
            </li>
            <li>
              <strong>Latency &amp; Packet Loss</strong> charts both live latency and rolling
              packet-loss % over time. Drag across the chart to zoom into a range; use the
              5m/15m/30m/1h/2h buttons to jump to a preset, or "Reset zoom" to snap back out.
            </li>
            <li>
              <strong>Network Path</strong> draws every hop from you to the target as a chain of
              nodes, colored by health. Hover a node for its IP, hostname, hosting/ISP org, and
              average response time. A hop that branches into several parallel nodes means different
              traceroute runs saw different routers answer there (load balancing).
            </li>
            <li>
              <strong>Route Table</strong> is an MTR-style view: one row per hop with loss % and a
              latency trend sparkline, aggregated across the last several traceroute runs.
            </li>
            <li>
              <strong>Ping History</strong> charts the 1-minute rollups kept in the database - pick
              24h/7d/30d to look back further than the live charts above can. "Pop out" opens it
              larger in its own window.
            </li>
          </ul>
        </section>

        <section>
          <h3>Overview tab</h3>
          <ul>
            <li>
              <strong>All targets</strong> overlays every target's latency on one shared chart;
              <strong> Individual</strong> gives each target its own chart, with checkboxes to
              show/hide specific ones. Dragging to zoom on any individual chart zooms all of them
              together.
            </li>
            <li>
              <strong>Fit all in view</strong> (Individual view only) zooms the whole window out
              just enough that every visible target's chart fits without scrolling - "Exit fit view"
              (same button) restores 100%.
            </li>
            <li>
              <strong>Ping interval</strong> sets how often every target is pinged, applied
              globally.
            </li>
          </ul>
        </section>

        <section>
          <h3>Alerts tab</h3>
          <ul>
            <li>
              Add a rule for a target on either packet loss (%) or latency (ms) crossing a threshold
              - a native notification fires when it's breached, and again when it recovers.
            </li>
            <li>Toggle a rule's checkbox to enable/disable it without deleting it.</li>
          </ul>
        </section>

        <section>
          <h3>Good to know</h3>
          <ul>
            <li>
              <strong>Ctrl/Cmd + / -</strong> zooms the whole app in/out;{' '}
              <strong>Ctrl/Cmd + 0</strong> resets it.
            </li>
            <li>
              Closing the window minimizes to the system tray instead of quitting - monitoring (and
              alerts) keep running in the background. Use the tray icon's "Quit" to actually exit.
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}

export default HelpDialog
