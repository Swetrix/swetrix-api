import {
  isInBrowser,
  isLocalhost,
  isAutomated,
  getLocale,
  getTimezone,
  getReferrer,
  getQueryString,
  getUTMCampaign,
  getUTMMedium,
  getUTMSource,
  getUTMTerm,
  getUTMContent,
  getPath,
} from './utils.js'

type RrwebEvent = Record<string, unknown>

type RrwebEmit = (event: RrwebEvent) => void

interface RrwebRecordOptions {
  emit?: RrwebEmit
  [key: string]: unknown
}

interface RrwebRecordFn {
  (options: RrwebRecordOptions): (() => void) | undefined
  takeFullSnapshot?: (isCheckout?: boolean) => void
}

interface RrwebGlobal {
  record?: RrwebRecordFn
  Replayer?: unknown
}

type RrwebRecordModule = RrwebGlobal & {
  default?: RrwebGlobal
}

type SessionReplayPreloadOption = boolean | { rrwebUrl?: string }

interface SessionReplayStartResponse {
  replayId: string
  nextChunkIndex: number
}

declare global {
  interface Window {
    // Legacy global set by full rrweb bundles (self-hosted or custom rrwebUrl).
    rrweb?: RrwebGlobal
    // Global set by the @rrweb/record UMD bundle we ship.
    rrwebRecord?: RrwebGlobal | RrwebRecordFn
    __SWETRIX_RRWEB_LOADING__?: Promise<void>
  }
}

/**
 * Key / value metadata describing an identified user (email, plan, signup
 * date, ...). Values are stored as strings; `null` removes a trait.
 */
export type Traits = Record<string, string | number | boolean | null>

export interface LibOptions {
  /**
   * When set to `true`, localhost events will be sent to server.
   */
  devMode?: boolean

  /**
   * When set to `true`, the tracking library won't send any data to server.
   * Useful for development purposes when this value is set based on `.env` var.
   */
  disabled?: boolean

  /**
   * By setting this flag to `true`, we will not collect ANY kind of data about the user with the DNT setting.
   */
  respectDNT?: boolean

  /** Set a custom URL of the API server; the default value is "https://api.swetrix.com/log"  */
  apiURL?: string

  /**
   * Optional profile ID for long-term user tracking.
   * If set, it will be used for all pageviews and events unless overridden per-call.
   */
  profileId?: string

  /**
   * Preload session replay recorder code. Recording only starts after calling startSessionReplay().
   */
  preloadSessionReplay?: SessionReplayPreloadOption
}

export interface TrackEventOptions {
  /** The custom event name. */
  ev: string

  /** If set to `true`, only 1 event with the same ID will be saved per user session. */
  unique?: boolean

  /** Event-related metadata object with string values. */
  meta?: {
    [key: string]: string | number | boolean | null | undefined
  }

  /** Optional profile ID for long-term user tracking. Overrides the global profileId if set. */
  profileId?: string
}

// Partial user-editable pageview payload
export interface IPageViewPayload {
  lc?: string
  tz?: string
  ref?: string
  so?: string
  me?: string
  ca?: string
  te?: string
  co?: string
  pg?: string | null

  /**
   * Raw URL query string of the landing page (without the leading `?`).
   * Used server-side to recover the traffic source from ad/social click
   * IDs (gclid, fbclid, etc.) when the browser stripped the referrer.
   */
  qs?: string

  /** Pageview-related metadata object with string values. */
  meta?: {
    [key: string]: string | number | boolean | null | undefined
  }

  /** Optional profile ID for long-term user tracking. Overrides the global profileId if set. */
  profileId?: string
}

// Partial user-editable error payload
export interface IErrorEventPayload {
  name: string
  message?: string | null
  lineno?: number | null
  colno?: number | null
  filename?: string | null
  stackTrace?: string | null
  meta?: {
    [key: string]: string | number | boolean | null | undefined
  }
}

export interface IInternalErrorEventPayload extends IErrorEventPayload {
  lc?: string
  tz?: string
  pg?: string | null
}

interface IPerfPayload {
  dns: number
  tls: number
  conn: number
  response: number
  render: number
  dom_load: number
  page_load: number
  ttfb: number
}

/**
 * Options for evaluating feature flags.
 */
export interface FeatureFlagsOptions {
  /**
   * Optional profile ID for long-term user tracking.
   * If not provided, an anonymous profile ID will be generated server-side based on IP and user agent.
   * Overrides the global profileId if set.
   */
  profileId?: string
}

/**
 * Options for evaluating experiments.
 */
export interface ExperimentOptions {
  /**
   * Optional profile ID for long-term user tracking.
   * If not provided, an anonymous profile ID will be generated server-side based on IP and user agent.
   * Overrides the global profileId if set.
   */
  profileId?: string
}

/**
 * Cached feature flags and experiments with timestamp.
 */
interface CachedData {
  flags: Record<string, boolean>
  experiments: Record<string, string>
  timestamp: number
  /** The profileId used when fetching this cached data */
  profileId?: string
}

/**
 * The object returned by `trackPageViews()`, used to stop tracking pages.
 */
export interface PageActions {
  /** Stops the tracking of pages. */
  stop: () => void
}

/**
 * The object returned by `trackErrors()`, used to stop tracking errors.
 */
export interface ErrorActions {
  /** Stops the tracking of errors. */
  stop: () => void
}

const SESSION_REPLAY_PRIVACY_VALUES = ['total', 'normal', 'none'] as const

export type SessionReplayPrivacy = (typeof SESSION_REPLAY_PRIVACY_VALUES)[number]

export interface SessionReplayOptions {
  privacy?: SessionReplayPrivacy
  rrweb?: RrwebRecordOptions
  flushIntervalMs?: number
  maxEventsPerChunk?: number
  maxBytesPerChunk?: number
  maxBytesPerEvent?: number
  sampleRate?: number
  maxDurationMs?: number
  idleTimeoutMs?: number
  maskAllText?: boolean
  recordIframes?: boolean
}

export interface SessionReplayActions {
  stop: () => Promise<void>
  flush: () => Promise<void>
}

export interface PageData {
  /** Current URL path. */
  path: string

  /** The object returned by `trackPageViews()`, used to stop tracking pages. */
  actions: PageActions
}

export interface ErrorOptions {
  /**
   * A number that indicates how many errors should be sent to the server.
   * Accepts values between 0 and 1. For example, if set to 0.5 - only ~50% of errors will be sent to Swetrix.
   * For testing, we recommend setting this value to 1. For production, you should configure it depending on your needs as each error event counts towards your plan.
   *
   * The default value for this option is 1.
   */
  sampleRate?: number

  /**
   * Callback to edit / prevent sending errors.
   *
   * @param payload - The error payload.
   * @returns The edited payload or `false` to prevent sending the error event. If `true` is returned, the payload will be sent as-is.
   */
  callback?: (payload: IInternalErrorEventPayload) => Partial<IInternalErrorEventPayload> | boolean
}

export interface PageViewsOptions {
  /**
   * If set to `true`, only unique events will be saved.
   * This param is useful when tracking single-page landing websites.
   */
  unique?: boolean

  /** Send Heartbeat requests when the website tab is not active in the browser. */
  heartbeatOnBackground?: boolean

  /**
   * Set to `true` to enable hash-based routing, or provide an array of hash values to include.
   * For example, use `true` for pages like /#/path, or `['pricing', 'features']` to include only those hashes.
   */
  hash?: boolean | readonly string[]

  /**
   * Set to `true` to enable search-based routing, or provide an array of query parameter names to include.
   * For example, use `true` for /path?search, or `['search', 'page']` to ignore all other parameters.
   */
  search?: boolean | readonly string[]

  /**
   * Callback to edit / prevent sending pageviews.
   *
   * @param payload - The pageview payload.
   * @returns The edited payload or `false` to prevent sending the pageview. If `true` is returned, the payload will be sent as-is.
   */
  callback?: (payload: IPageViewPayload) => Partial<IPageViewPayload> | boolean
}

export const defaultActions = {
  stop() {},
}

export const defaultSessionReplayActions: SessionReplayActions = {
  async stop() {},
  async flush() {},
}

const DEFAULT_API_HOST = 'https://api.swetrix.com/log'
const DEFAULT_API_BASE = 'https://api.swetrix.com'

/**
 * Events carry the raw, site-supplied profileId; the server stores them behind
 * this prefix. Mirrored here so getProfileId() can report the ID events are
 * actually stored under without an extra round trip.
 */
const USER_PROFILE_PREFIX = 'usr_'

const toStoredProfileId = (profileId: string) => `${USER_PROFILE_PREFIX}${profileId.trim()}`

const DEFAULT_RRWEB_FILE = 'replaylibrary.min.js'
const DEFAULT_RRWEB_URL = `https://cdn.jsdelivr.net/npm/swetrix@latest/dist/${DEFAULT_RRWEB_FILE}`
const DEFAULT_SESSION_REPLAY_FLUSH_INTERVAL = 5000
const DEFAULT_SESSION_REPLAY_MAX_EVENTS = 100
const DEFAULT_SESSION_REPLAY_MAX_CHUNK_BYTES = 512 * 1024
const DEFAULT_SESSION_REPLAY_MAX_EVENT_BYTES = 5 * 1024 * 1024
const DEFAULT_SESSION_REPLAY_MAX_DURATION_MS = 30 * 60 * 1000
const DEFAULT_SESSION_REPLAY_PRIVACY: SessionReplayPrivacy = 'total'
const DEFAULT_SESSION_REPLAY_SAMPLING = {
  mousemove: 50,
  scroll: 150,
  input: 'last',
}
const DEFAULT_SESSION_REPLAY_SLIM_DOM_OPTIONS = {
  script: true,
  comment: true,
  headFavicon: true,
  headWhitespace: true,
  headMetaDescKeywords: true,
  headMetaSocial: true,
  headMetaRobots: true,
  headMetaHttpEquiv: true,
  headMetaAuthorship: true,
  headMetaVerification: true,
}
const RRWEB_EVENT_FULL_SNAPSHOT = 2
// Chunk indices are reserved server-side, so retrying with the same index is
// idempotent - the backend dedupes on (replayId, chunkIndex).
const SESSION_REPLAY_CHUNK_RETRY_DELAYS_MS = [2_000, 5_000, 15_000]
// Snapshots are the largest payload we send, so a hop that rejects big bodies
// rejects every re-seed too. Cap the attempts rather than re-uploading a
// multi-megabyte snapshot on a loop for the rest of the session.
const SESSION_REPLAY_MAX_SNAPSHOT_RESEEDS = 3
const SESSION_REPLAY_ACTIVITY_EVENTS = ['click', 'keydown', 'mousedown', 'mousemove', 'scroll', 'touchstart'] as const

// Default cache duration: 5 minutes
const DEFAULT_CACHE_DURATION = 5 * 60 * 1000

const getStringByteLength = (value: string) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }

  if (typeof Blob !== 'undefined') {
    return new Blob([value]).size
  }

  return value.length
}

export class Lib {
  private pageData: PageData | null = null
  private pageViewsOptions?: PageViewsOptions | null = null
  private errorsOptions?: ErrorOptions | null = null
  private perfStatsCollected: boolean = false
  private activePage: string | null = null
  private errorListenerExists = false
  private cachedData: CachedData | null = null
  private rrwebLoader: Promise<void> | null = null
  private sessionReplayActions: SessionReplayActions | null = null
  private sessionReplayInitPromise: Promise<SessionReplayActions> | null = null
  // The server-side (usr_-prefixed) profile ID returned by the identify API
  private identifiedProfileId: string | null = null
  // The last profile ID sent to the identify API (to avoid duplicate requests)
  private lastIdentifySent: string | null = null

  constructor(
    private projectID: string,
    private options?: LibOptions,
  ) {
    this.trackPathChange = this.trackPathChange.bind(this)
    this.heartbeat = this.heartbeat.bind(this)
    this.captureError = this.captureError.bind(this)

    if (this.getSessionReplayPreloadOption()) {
      void this.preloadSessionReplay().catch(() => undefined)
    }
  }

  captureError(event: ErrorEvent): void {
    if (typeof this.errorsOptions?.sampleRate === 'number' && this.errorsOptions.sampleRate >= Math.random()) {
      return
    }

    this.submitError(
      {
        // The file in which error occured.
        filename: event.filename,

        // The line of code error occured on.
        lineno: event.lineno,

        // The column of code error occured on.
        colno: event.colno,

        // Name of the error, if not exists (i.e. it's a custom thrown error). The initial value of name is "Error", but just in case lets explicitly set it here too.
        name: event.error?.name || 'Error',

        // Description of the error. By default, we use message from Error object, is it does not contain the error name
        // (we want to split error name and message so we could group them together later in dashboard).
        // If message in error object does not exist - lets use a message from the Error event itself.
        message: event.error?.message || event.message,

        // Stack trace of the error, if available.
        stackTrace: event.error?.stack,
      },
      true,
    )
  }

  trackErrors(options?: ErrorOptions): ErrorActions {
    if (this.errorListenerExists || !this.canTrack()) {
      return defaultActions
    }

    this.errorsOptions = options

    window.addEventListener('error', this.captureError)
    this.errorListenerExists = true

    return {
      stop: () => {
        window.removeEventListener('error', this.captureError)
        this.errorListenerExists = false
      },
    }
  }

  submitError(payload: IErrorEventPayload, evokeCallback?: boolean): void {
    const privateData = {
      pid: this.projectID,
    }

    const errorPayload = {
      pg:
        this.activePage ||
        getPath({
          hash: this.pageViewsOptions?.hash,
          search: this.pageViewsOptions?.search,
        }),
      lc: getLocale(),
      tz: getTimezone(),
      ...payload,
    }

    if (evokeCallback && this.errorsOptions?.callback) {
      const callbackResult = this.errorsOptions.callback(errorPayload)

      if (callbackResult === false) {
        return
      }

      if (callbackResult && typeof callbackResult === 'object') {
        Object.assign(errorPayload, callbackResult)
      }
    }

    Object.assign(errorPayload, privateData)

    this.sendRequest('error', errorPayload)
  }

  async track(event: TrackEventOptions): Promise<void> {
    if (!this.canTrack()) {
      return
    }

    const data = {
      ...event,
      pid: this.projectID,
      pg:
        this.activePage ||
        getPath({
          hash: this.pageViewsOptions?.hash,
          search: this.pageViewsOptions?.search,
        }),
      lc: getLocale(),
      tz: getTimezone(),
      ref: getReferrer(),
      so: getUTMSource(),
      me: getUTMMedium(),
      ca: getUTMCampaign(),
      te: getUTMTerm(),
      co: getUTMContent(),
      qs: getQueryString(),
      profileId: event.profileId ?? this.options?.profileId,
    }
    await this.sendRequest('custom', data)
  }

  trackPageViews(options?: PageViewsOptions): PageActions {
    if (!this.canTrack()) {
      return defaultActions
    }

    if (this.pageData) {
      return this.pageData.actions
    }

    this.pageViewsOptions = options
    let interval: ReturnType<typeof setInterval>

    if (!options?.unique) {
      interval = setInterval(this.trackPathChange, 2000)
    }

    setTimeout(this.heartbeat, 3000)
    const hbInterval = setInterval(this.heartbeat, 28000)

    const path = getPath({
      hash: options?.hash,
      search: options?.search,
    })

    this.pageData = {
      path,
      actions: {
        stop: () => {
          clearInterval(interval)
          clearInterval(hbInterval)
        },
      },
    }

    this.trackPage(path, options?.unique)
    return this.pageData.actions
  }

  getPerformanceStats(): IPerfPayload | {} {
    if (!this.canTrack() || this.perfStatsCollected || !window.performance?.getEntriesByType) {
      return {}
    }

    const perf = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming

    if (!perf) {
      return {}
    }

    this.perfStatsCollected = true

    return {
      // Network
      dns: perf.domainLookupEnd - perf.domainLookupStart, // DNS Resolution
      tls: perf.secureConnectionStart ? perf.requestStart - perf.secureConnectionStart : 0, // TLS Setup; checking if secureConnectionStart is not 0 (it's 0 for non-https websites)
      conn: perf.secureConnectionStart
        ? perf.secureConnectionStart - perf.connectStart
        : perf.connectEnd - perf.connectStart, // Connection time
      response: perf.responseEnd - perf.responseStart, // Response Time (Download)

      // Frontend
      render: perf.domComplete - perf.domContentLoadedEventEnd, // Browser rendering the HTML time
      dom_load: perf.domContentLoadedEventEnd - perf.responseEnd, // DOM loading timing
      page_load: perf.loadEventStart, // Page load time

      // Backend
      ttfb: perf.responseStart - perf.requestStart,
    }
  }

  /**
   * Fetches all feature flags for the project.
   * Results are cached for 5 minutes by default and share a cache with experiments.
   *
   * @param options - Options for evaluating feature flags (`profileId` only).
   * @param forceRefresh - If true, bypasses the cache and fetches fresh data.
   * @returns A promise that resolves to a record of flag keys to boolean values.
   */
  async getFeatureFlags(options?: FeatureFlagsOptions, forceRefresh?: boolean): Promise<Record<string, boolean>> {
    if (!isInBrowser()) {
      return {}
    }

    const requestedProfileId = options?.profileId ?? this.options?.profileId

    // Check cache first - must match profileId and not be expired
    if (!forceRefresh && this.cachedData) {
      const now = Date.now()
      const isSameProfile = this.cachedData.profileId === requestedProfileId
      if (isSameProfile && now - this.cachedData.timestamp < DEFAULT_CACHE_DURATION) {
        return this.cachedData.flags
      }
    }

    try {
      await this.fetchFlagsAndExperiments(options)
      return this.cachedData?.flags || {}
    } catch (error) {
      console.warn('[Swetrix] Error fetching feature flags:', error)
      return this.cachedData?.flags || {}
    }
  }

  /**
   * Internal method to fetch both feature flags and experiments from the API.
   */
  private async fetchFlagsAndExperiments(options?: FeatureFlagsOptions | ExperimentOptions): Promise<void> {
    const apiBase = this.getApiBase()
    const body: { pid: string; profileId?: string } = {
      pid: this.projectID,
    }

    // Use profileId from options, or fall back to global profileId
    const profileId = options?.profileId ?? this.options?.profileId
    if (profileId) {
      body.profileId = profileId
    }

    const response = await fetch(`${apiBase}/feature-flag/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.warn('[Swetrix] Failed to fetch feature flags and experiments:', response.status)
      return
    }

    const data = (await response.json()) as {
      flags: Record<string, boolean>
      experiments?: Record<string, string>
    }

    // Use profileId from options, or fall back to global profileId
    const cachedProfileId = options?.profileId ?? this.options?.profileId

    // Update cache with both flags and experiments
    this.cachedData = {
      flags: data.flags || {},
      experiments: data.experiments || {},
      timestamp: Date.now(),
      profileId: cachedProfileId,
    }
  }

  /**
   * Gets the value of a single feature flag.
   *
   * @param key - The feature flag key.
   * @param options - Options for evaluating the feature flag (`profileId` only).
   * @param defaultValue - Optional default value to return if the flag is not found. Defaults to false.
   * @returns A promise that resolves to the boolean value of the flag.
   */
  async getFeatureFlag(key: string, options?: FeatureFlagsOptions, defaultValue: boolean = false): Promise<boolean> {
    const flags = await this.getFeatureFlags(options)
    return flags[key] ?? defaultValue
  }

  /**
   * Clears the cached feature flags and experiments, forcing a fresh fetch on the next call.
   */
  clearFeatureFlagsCache(): void {
    this.cachedData = null
  }

  /**
   * Identify the current visitor with your own user ID (e.g. after they log in).
   *
   * The visitor's current anonymous profile gets linked to the identified
   * profile server-side, so their pre-login activity is attributed to it. All
   * events sent after this call are associated with the identified profile.
   *
   * Swetrix stores nothing in the browser, so call identify() on every page
   * load while the user is logged in. Call reset() when they log out.
   *
   * @param profileId A unique, stable identifier of the user, e.g. an internal
   * user ID. It's stored as you provide it, so don't pass values you wouldn't
   * want to see in your dashboard.
   * @param traits Optional key / value metadata to show on the user's profile,
   * e.g. their email, plan or signup date. Traits are merged with the ones
   * already stored; pass `null` to remove one.
   */
  async identify(profileId: string, traits?: Traits): Promise<void> {
    if (typeof profileId !== 'string' || !profileId.trim()) {
      console.error('[Swetrix] identify() expects a non-empty string profileId')
      return
    }

    const trimmed = profileId.trim()

    this.options = {
      ...this.options,
      profileId: trimmed,
    }

    // Traits are part of the payload, so re-send when only they changed
    const identifyKey = `${trimmed}:${traits ? JSON.stringify(traits) : ''}`

    if (!this.canTrack() || this.lastIdentifySent === identifyKey) {
      return
    }

    this.lastIdentifySent = identifyKey

    // The profile changed, so cached flags / experiments may no longer apply
    this.clearFeatureFlagsCache()

    try {
      const apiBase = this.getApiBase()
      const response = await fetch(`${apiBase}/log/identify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pid: this.projectID, profileId: trimmed, traits }),
      })

      if (!response.ok) {
        return
      }

      const data = (await response.json()) as { profileId: string | null }
      this.identifiedProfileId = data.profileId || null
    } catch {
      // Keep the profileId set locally even if the identify request failed -
      // events will still be attributed to the identified profile
    }
  }

  /**
   * Updates the traits of the already identified visitor without having to
   * repeat their user ID. Only the keys you pass are touched; pass `null` to
   * remove a trait.
   */
  async setTraits(traits: Traits): Promise<void> {
    const profileId = this.options?.profileId

    if (!profileId) {
      console.error('[Swetrix] setTraits() requires the visitor to be identified via identify() first')
      return
    }

    if (!traits || typeof traits !== 'object' || Array.isArray(traits)) {
      console.error('[Swetrix] setTraits() expects an object of traits')
      return
    }

    await this.identify(profileId, traits)
  }

  /**
   * Resets the visitor's identity set via identify() (e.g. after they log
   * out), so subsequent events are tracked anonymously again. Important on
   * shared devices - otherwise the next visitor would be tracked under the
   * previous user's identity.
   */
  reset(): void {
    if (this.options) {
      delete this.options.profileId
    }

    this.identifiedProfileId = null
    this.lastIdentifySent = null
    this.clearFeatureFlagsCache()
  }

  /**
   * Fetches variant assignments for running A/B test experiments returned by feature flag evaluation.
   * Results are cached for 5 minutes by default (shared cache with feature flags).
   *
   * @param options - Options for evaluating experiments (`profileId` only).
   * @param forceRefresh - If true, bypasses the cache and fetches fresh data.
   * @returns A promise that resolves to a record of experiment IDs to variant keys.
   *
   * @example
   * ```typescript
   * const experiments = await getExperiments({ profileId: 'user-123' })
   * // experiments = { 'exp-123': 'variant-a', 'exp-456': 'control' }
   * ```
   */
  async getExperiments(options?: ExperimentOptions, forceRefresh?: boolean): Promise<Record<string, string>> {
    if (!isInBrowser()) {
      return {}
    }

    const requestedProfileId = options?.profileId ?? this.options?.profileId

    // Check cache first - must match profileId and not be expired
    if (!forceRefresh && this.cachedData) {
      const now = Date.now()
      const isSameProfile = this.cachedData.profileId === requestedProfileId
      if (isSameProfile && now - this.cachedData.timestamp < DEFAULT_CACHE_DURATION) {
        return this.cachedData.experiments
      }
    }

    try {
      await this.fetchFlagsAndExperiments(options)
      return this.cachedData?.experiments || {}
    } catch (error) {
      console.warn('[Swetrix] Error fetching experiments:', error)
      return this.cachedData?.experiments || {}
    }
  }

  /**
   * Gets the variant key for a specific A/B test experiment.
   *
   * @param experimentId - The experiment ID.
   * @param options - Options for evaluating the experiment (`profileId` only).
   * @param defaultVariant - Optional default variant key to return if the experiment is not found. Defaults to null.
   * @returns A promise that resolves to the variant key assigned to this user, or defaultVariant if not found.
   *
   * @example
   * ```typescript
   * const variant = await getExperiment('checkout-redesign', { profileId: 'user-123' })
   *
   * // Optional fallback variant:
   * const variantWithFallback = await getExperiment('checkout-redesign', undefined, 'control')
   *
   * if (variant === 'new-checkout') {
   *   // Show new checkout flow
   * } else {
   *   // Show control (original) checkout
   * }
   * ```
   */
  async getExperiment(
    experimentId: string,
    options?: ExperimentOptions,
    defaultVariant: string | null = null,
  ): Promise<string | null> {
    const experiments = await this.getExperiments(options)
    return experiments[experimentId] ?? defaultVariant
  }

  /**
   * Clears the cached experiments (alias for clearFeatureFlagsCache since they share the same cache).
   */
  clearExperimentsCache(): void {
    this.cachedData = null
  }

  /**
   * Gets the profile ID the current visitor's events are stored under.
   * If the visitor was identified via identify(), or a profileId was set via
   * init options, returns the identified (usr_-prefixed) ID. Otherwise,
   * requests server to generate an anonymous one from IP/UA hash.
   *
   * This ID can be used for revenue attribution with payment providers.
   *
   * @returns A promise that resolves to the profile ID string, or null on error.
   *
   * @example
   * ```typescript
   * const profileId = await swetrix.getProfileId()
   *
   * // Pass to Paddle Checkout for revenue attribution
   * Paddle.Checkout.open({
   *   items: [{ priceId: 'pri_01234567890', quantity: 1 }],
   *   customData: {
   *     swetrix_profile_id: profileId,
   *     swetrix_session_id: await swetrix.getSessionId()
   *   }
   * })
   * ```
   */
  async getProfileId(): Promise<string | null> {
    // If the visitor was identified, return the server-side (usr_-prefixed)
    // profile ID, which is what events are stored under
    if (this.identifiedProfileId) {
      return this.identifiedProfileId
    }

    // A profileId set via init() (or a failed identify() call) is sent raw on
    // events and prefixed server-side, so return the prefixed form here too -
    // returning the raw value would not match anything in the dashboard
    if (this.options?.profileId) {
      return toStoredProfileId(this.options.profileId)
    }

    if (!isInBrowser()) {
      return null
    }

    try {
      const apiBase = this.getApiBase()
      const response = await fetch(`${apiBase}/log/profile-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pid: this.projectID }),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as { profileId: string | null }
      return data.profileId
    } catch {
      return null
    }
  }

  /**
   * Gets the current session ID for the visitor.
   * Session IDs are generated server-side based on IP and user agent.
   *
   * This ID can be used for revenue attribution with payment providers.
   *
   * @returns A promise that resolves to the session ID string, or null on error.
   *
   * @example
   * ```typescript
   * const sessionId = await swetrix.getSessionId()
   *
   * // Pass to Paddle Checkout for revenue attribution
   * Paddle.Checkout.open({
   *   items: [{ priceId: 'pri_01234567890', quantity: 1 }],
   *   customData: {
   *     swetrix_profile_id: await swetrix.getProfileId(),
   *     swetrix_session_id: sessionId
   *   }
   * })
   * ```
   */
  async getSessionId(): Promise<string | null> {
    if (!isInBrowser()) {
      return null
    }

    try {
      const apiBase = this.getApiBase()
      const response = await fetch(`${apiBase}/log/session-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pid: this.projectID }),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as { sessionId: string | null }
      return data.sessionId
    } catch {
      return null
    }
  }

  async startSessionReplay(options: SessionReplayOptions = {}): Promise<SessionReplayActions> {
    if (this.sessionReplayActions) {
      return this.sessionReplayActions
    }

    if (this.sessionReplayInitPromise) {
      return this.sessionReplayInitPromise
    }

    const initPromise = this.initialiseSessionReplay(options)
    this.sessionReplayInitPromise = initPromise

    try {
      return await initPromise
    } finally {
      if (this.sessionReplayInitPromise === initPromise) {
        this.sessionReplayInitPromise = null
      }
    }
  }

  private async initialiseSessionReplay(options: SessionReplayOptions): Promise<SessionReplayActions> {
    if (this.sessionReplayActions) {
      return this.sessionReplayActions
    }

    if (!this.canTrack()) {
      return defaultSessionReplayActions
    }

    const maxDurationMs =
      typeof options.maxDurationMs === 'number' && options.maxDurationMs > 0
        ? options.maxDurationMs
        : DEFAULT_SESSION_REPLAY_MAX_DURATION_MS

    if (!this.shouldSampleSessionReplay(options.sampleRate)) {
      return defaultSessionReplayActions
    }

    try {
      await this.preloadSessionReplay()
    } catch {
      return defaultSessionReplayActions
    }

    const record = this.getRrwebRecorder()
    if (!record) {
      return defaultSessionReplayActions
    }

    const privacy = this.getSessionReplayPrivacy(options.privacy)
    const proposedReplayId = this.createReplayId()
    const started = await this.sendSessionReplayStart(proposedReplayId, privacy)

    if (!started) {
      return defaultSessionReplayActions
    }

    const replayId = started.replayId

    const flushIntervalMs =
      typeof options.flushIntervalMs === 'number' && options.flushIntervalMs > 0
        ? options.flushIntervalMs
        : DEFAULT_SESSION_REPLAY_FLUSH_INTERVAL
    const maxEventsPerChunk =
      typeof options.maxEventsPerChunk === 'number' && options.maxEventsPerChunk > 0
        ? Math.floor(options.maxEventsPerChunk)
        : DEFAULT_SESSION_REPLAY_MAX_EVENTS
    const maxBytesPerChunkCandidate =
      typeof options.maxBytesPerChunk === 'number' ? Math.floor(options.maxBytesPerChunk) : Number.NaN
    const maxBytesPerChunk =
      maxBytesPerChunkCandidate >= 1 ? maxBytesPerChunkCandidate : DEFAULT_SESSION_REPLAY_MAX_CHUNK_BYTES
    const maxBytesPerEventCandidate =
      typeof options.maxBytesPerEvent === 'number' ? Math.floor(options.maxBytesPerEvent) : Number.NaN
    const maxBytesPerEvent =
      maxBytesPerEventCandidate >= 1 ? maxBytesPerEventCandidate : DEFAULT_SESSION_REPLAY_MAX_EVENT_BYTES
    const idleTimeoutMs =
      typeof options.idleTimeoutMs === 'number' && options.idleTimeoutMs > 0 ? options.idleTimeoutMs : null

    let chunkIndex = started.nextChunkIndex
    let snapshotReseeds = 0
    let stopped = false
    let events: RrwebEvent[] = []
    let eventsByteLength = 0
    let flushing = Promise.resolve()
    let maxDurationTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const flush = async (useBeacon = false) => {
      if (!events.length) return

      const chunk = events
      events = []
      eventsByteLength = 0
      const currentChunkIndex = chunkIndex++

      flushing = flushing
        .catch(() => undefined)
        .then(async () => {
          const delivered = await this.sendSessionReplayChunk(replayId, privacy, currentChunkIndex, chunk, useBeacon)

          // Losing a full snapshot makes every later event unrenderable, so
          // re-seed the stream instead of recording into the void.
          if (
            !delivered &&
            !stopped &&
            snapshotReseeds < SESSION_REPLAY_MAX_SNAPSHOT_RESEEDS &&
            chunk.some((event) => event.type === RRWEB_EVENT_FULL_SNAPSHOT)
          ) {
            snapshotReseeds += 1
            try {
              record.takeFullSnapshot?.()
            } catch {}
          }
        })

      await flushing
    }

    const userEmit = options.rrweb?.emit
    const recordOptions = this.getSessionReplayRecordOptions(
      privacy,
      options.rrweb,
      (event) => {
        try {
          userEmit?.(event)
        } catch {}

        let eventByteLength = 0

        try {
          eventByteLength = getStringByteLength(JSON.stringify(event))
        } catch {
          return
        }

        if (eventByteLength > maxBytesPerEvent) {
          return
        }

        if (events.length && eventsByteLength + eventByteLength > maxBytesPerChunk) {
          void flush()
        }

        events.push(event)
        eventsByteLength += eventByteLength
        if (events.length >= maxEventsPerChunk || eventsByteLength >= maxBytesPerChunk) {
          void flush()
        }
      },
      Boolean(options.recordIframes),
      options.maskAllText,
    )

    const stopRecording = record(recordOptions)
    const timer = setInterval(() => void flush(), flushIntervalMs)
    const flushOnPageExit = () => void flush(true)
    const flushOnHidden = () => {
      if (document.visibilityState === 'hidden') {
        void flush(true)
      }
    }
    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }
    const stopSessionReplay = async () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      if (maxDurationTimer) {
        clearTimeout(maxDurationTimer)
      }
      clearIdleTimer()
      window.removeEventListener('pagehide', flushOnPageExit)
      document.removeEventListener('visibilitychange', flushOnHidden)
      SESSION_REPLAY_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetIdleTimer)
      })
      stopRecording?.()
      await flush()
      this.sessionReplayActions = null
      this.sessionReplayInitPromise = null
    }
    const resetIdleTimer = () => {
      if (!idleTimeoutMs || stopped) return
      clearIdleTimer()
      idleTimer = setTimeout(() => void stopSessionReplay(), idleTimeoutMs)
    }

    window.addEventListener('pagehide', flushOnPageExit)
    document.addEventListener('visibilitychange', flushOnHidden)

    maxDurationTimer = setTimeout(() => void stopSessionReplay(), maxDurationMs)

    if (idleTimeoutMs) {
      SESSION_REPLAY_ACTIVITY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, resetIdleTimer, { passive: true })
      })
      resetIdleTimer()
    }

    this.sessionReplayActions = {
      stop: stopSessionReplay,
      flush: async () => {
        await flush()
      },
    }

    return this.sessionReplayActions
  }

  private shouldSampleSessionReplay(sampleRate?: number): boolean {
    if (typeof sampleRate !== 'number') {
      return true
    }

    if (sampleRate <= 0) {
      return false
    }

    if (sampleRate >= 1) {
      return true
    }

    return Math.random() < sampleRate
  }

  private getSessionReplayPrivacy(privacy: unknown): SessionReplayPrivacy {
    return SESSION_REPLAY_PRIVACY_VALUES.includes(privacy as SessionReplayPrivacy)
      ? (privacy as SessionReplayPrivacy)
      : DEFAULT_SESSION_REPLAY_PRIVACY
  }

  /**
   * Gets the API base URL (without /log suffix).
   */
  private getApiBase(): string {
    if (this.options?.apiURL) {
      // Remove trailing /log if present
      return this.options.apiURL.replace(/\/log\/?$/, '')
    }
    return DEFAULT_API_BASE
  }

  private heartbeat(): void {
    if (!this.pageViewsOptions?.heartbeatOnBackground && document.visibilityState === 'hidden') {
      return
    }

    const data: { pid: string; profileId?: string } = {
      pid: this.projectID,
    }

    if (this.options?.profileId) {
      data.profileId = this.options.profileId
    }

    this.sendRequest('hb', data)
  }

  // Tracking path changes. If path changes -> calling this.trackPage method
  private trackPathChange(): void {
    if (!this.pageData) return
    const newPath = getPath({
      hash: this.pageViewsOptions?.hash,
      search: this.pageViewsOptions?.search,
    })
    const { path } = this.pageData

    if (path !== newPath) {
      this.trackPage(newPath, false)
    }
  }

  private trackPage(pg: string, unique: boolean = false): void {
    if (!this.pageData) return
    this.pageData.path = pg

    const perf = this.getPerformanceStats()

    this.activePage = pg
    this.submitPageView({ pg }, unique, perf, true)
  }

  submitPageView(
    payload: Partial<IPageViewPayload>,
    unique: boolean,
    perf: IPerfPayload | {},
    evokeCallback?: boolean,
  ): void {
    const privateData = {
      pid: this.projectID,
      perf,
      unique,
    }

    const pvPayload = {
      lc: getLocale(),
      tz: getTimezone(),
      ref: getReferrer(),
      so: getUTMSource(),
      me: getUTMMedium(),
      ca: getUTMCampaign(),
      te: getUTMTerm(),
      co: getUTMContent(),
      qs: getQueryString(),
      profileId: this.options?.profileId,
      ...payload,
    }

    if (evokeCallback && this.pageViewsOptions?.callback) {
      const callbackResult = this.pageViewsOptions.callback(pvPayload as IPageViewPayload)

      if (callbackResult === false) {
        return
      }

      if (callbackResult && typeof callbackResult === 'object') {
        Object.assign(pvPayload, callbackResult)
      }
    }

    // Custom events and errors resolve their page from `activePage`, so any pageview that is
    // actually sent should update it - including the manual `pageview()` calls that apps with
    // routing the tracker cannot detect rely on. Without this, every event in such an app is
    // attributed to whichever page the visitor landed on.
    if (evokeCallback || pvPayload.pg) {
      this.activePage = pvPayload.pg || null
    }

    Object.assign(pvPayload, privateData)

    this.sendRequest('', pvPayload)
  }

  private canTrack(): boolean {
    if (
      this.options?.disabled ||
      !isInBrowser() ||
      (this.options?.respectDNT && window.navigator?.doNotTrack === '1') ||
      (!this.options?.devMode && isLocalhost()) ||
      isAutomated()
    ) {
      return false
    }

    return true
  }

  private getSessionReplayUrl(): string {
    const replayOption = this.getSessionReplayPreloadOption()
    if (replayOption && typeof replayOption === 'object' && replayOption.rrwebUrl) {
      return replayOption.rrwebUrl
    }

    return this.getDefaultSessionReplayUrl()
  }

  private getSessionReplayPreloadOption(): SessionReplayPreloadOption | undefined {
    return this.options?.preloadSessionReplay
  }

  private getDefaultSessionReplayUrl(): string {
    if (!isInBrowser()) {
      return DEFAULT_RRWEB_URL
    }

    const trackerScript = this.getTrackerScript()

    if (trackerScript?.src) {
      const { hostname, pathname } = new URL(trackerScript.src)
      if (hostname === 'swetrix.org' && /^\/swetrix(\.min)?\.js$/i.test(pathname)) {
        return DEFAULT_RRWEB_URL
      }

      return new URL(DEFAULT_RRWEB_FILE, trackerScript.src).toString()
    }

    return DEFAULT_RRWEB_URL
  }

  private getTrackerScript(): HTMLScriptElement | undefined {
    const trackerScript = Array.from(document.scripts).find((script) => {
      if (!script.src) {
        return false
      }

      try {
        const { pathname } = new URL(script.src)
        return /(^|\/)swetrix(\.min)?\.js$/i.test(pathname)
      } catch {
        return false
      }
    })

    return trackerScript
  }

  private getRrwebRecorder(): RrwebRecordFn | undefined {
    if (!isInBrowser()) {
      return undefined
    }

    if (typeof window.rrweb?.record === 'function') {
      return window.rrweb.record
    }

    const globalRecord = window.rrwebRecord
    if (typeof globalRecord === 'function') {
      return globalRecord
    }

    if (globalRecord && typeof globalRecord.record === 'function') {
      return globalRecord.record
    }

    return undefined
  }

  private preloadSessionReplay(): Promise<void> {
    if (!isInBrowser()) {
      return Promise.resolve()
    }

    if (this.getRrwebRecorder()) {
      return Promise.resolve()
    }

    if (this.rrwebLoader) {
      return this.rrwebLoader
    }

    if (window.__SWETRIX_RRWEB_LOADING__) {
      this.rrwebLoader = window.__SWETRIX_RRWEB_LOADING__
      void this.rrwebLoader.catch(() => {
        if (window.__SWETRIX_RRWEB_LOADING__ === this.rrwebLoader) {
          delete window.__SWETRIX_RRWEB_LOADING__
        }
        this.rrwebLoader = null
      })
      return this.rrwebLoader
    }

    this.rrwebLoader = this.loadSessionReplayRecorder()

    window.__SWETRIX_RRWEB_LOADING__ = this.rrwebLoader
    const loader = this.rrwebLoader
    void loader.catch(() => {
      if (window.__SWETRIX_RRWEB_LOADING__ === loader) {
        delete window.__SWETRIX_RRWEB_LOADING__
      }
      if (this.rrwebLoader === loader) {
        this.rrwebLoader = null
      }
    })

    return this.rrwebLoader
  }

  private async loadSessionReplayRecorder(): Promise<void> {
    const replayOption = this.getSessionReplayPreloadOption()
    const hasCustomReplayUrl = replayOption && typeof replayOption === 'object' && replayOption.rrwebUrl

    if (hasCustomReplayUrl || this.getTrackerScript()) {
      await this.loadSessionReplayScript(this.getSessionReplayUrl())
      return
    }

    if (await this.loadSessionReplayPackage()) {
      return
    }

    await this.loadSessionReplayScript(this.getDefaultSessionReplayUrl())
  }

  private async loadSessionReplayPackage(): Promise<boolean> {
    try {
      const rrwebModule = (await import('@rrweb/record')) as RrwebRecordModule
      const record = rrwebModule.record || rrwebModule.default?.record

      if (typeof record !== 'function') {
        return false
      }

      window.rrwebRecord = { record }
      return true
    } catch {
      return false
    }
  }

  private loadSessionReplayScript(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.async = true
      script.src = url
      script.crossOrigin = 'anonymous'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load rrweb'))
      document.head.appendChild(script)
    })
  }

  private getSessionReplayRecordOptions(
    privacy: unknown,
    userOptions: RrwebRecordOptions | undefined,
    emit: RrwebEmit,
    recordIframes: boolean,
    maskAllText?: boolean,
  ): RrwebRecordOptions {
    const hasUserSampling = userOptions && Object.prototype.hasOwnProperty.call(userOptions, 'sampling')
    const hasUserSlimDOMOptions = userOptions && Object.prototype.hasOwnProperty.call(userOptions, 'slimDOMOptions')
    const sampling =
      typeof userOptions?.sampling === 'object' && userOptions.sampling !== null
        ? {
            ...DEFAULT_SESSION_REPLAY_SAMPLING,
            ...(userOptions.sampling as Record<string, unknown>),
          }
        : hasUserSampling
          ? userOptions?.sampling
          : DEFAULT_SESSION_REPLAY_SAMPLING
    const slimDOMOptions =
      typeof userOptions?.slimDOMOptions === 'object' && userOptions.slimDOMOptions !== null
        ? {
            ...DEFAULT_SESSION_REPLAY_SLIM_DOM_OPTIONS,
            ...(userOptions.slimDOMOptions as Record<string, unknown>),
          }
        : hasUserSlimDOMOptions
          ? userOptions?.slimDOMOptions
          : DEFAULT_SESSION_REPLAY_SLIM_DOM_OPTIONS
    const options: RrwebRecordOptions = {
      recordCanvas: false,
      recordCrossOriginIframes: false,
      collectFonts: false,
      inlineImages: false,
      ...userOptions,
      sampling,
      slimDOMOptions,
      emit,
    }

    const maskInputOptions =
      typeof options.maskInputOptions === 'object' && options.maskInputOptions !== null
        ? (options.maskInputOptions as Record<string, unknown>)
        : {}

    const resolvedPrivacy = this.getSessionReplayPrivacy(privacy)
    const defaultBlockSelector = recordIframes ? undefined : 'iframe'
    const resolvedMaskAllText = typeof maskAllText === 'boolean' ? maskAllText : resolvedPrivacy === 'total'
    const textMaskingOptions = resolvedMaskAllText ? { maskTextSelector: '*' } : {}

    if (resolvedPrivacy === 'total') {
      return {
        ...options,
        ...textMaskingOptions,
        maskAllInputs: true,
        blockSelector: this.mergeSelectors(
          this.mergeSelectors(options.blockSelector, defaultBlockSelector),
          'img, picture, video, audio, canvas, svg',
        ),
        recordCanvas: false,
        inlineImages: false,
        emit,
      }
    }

    if (resolvedPrivacy === 'normal') {
      return {
        ...options,
        ...textMaskingOptions,
        maskAllInputs: true,
        blockSelector: this.mergeSelectors(options.blockSelector, defaultBlockSelector),
        emit,
      }
    }

    return {
      ...options,
      ...textMaskingOptions,
      blockSelector: this.mergeSelectors(options.blockSelector, defaultBlockSelector),
      maskInputOptions: {
        ...maskInputOptions,
        password: true,
      },
      emit,
    }
  }

  private mergeSelectors(existing: unknown, required?: string): string | undefined {
    if (!required) {
      return typeof existing === 'string' ? existing : undefined
    }

    if (typeof existing === 'string' && existing.trim()) {
      return `${existing}, ${required}`
    }

    return required
  }

  private createReplayId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  private async sendSessionReplayStart(
    replayId: string,
    privacy: SessionReplayPrivacy,
  ): Promise<SessionReplayStartResponse | null> {
    try {
      const apiBase = this.getApiBase()
      const response = await fetch(`${apiBase}/log/session-replay/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pid: this.projectID,
          replayId,
          privacy,
          pg:
            this.activePage ||
            getPath({
              hash: this.pageViewsOptions?.hash,
              search: this.pageViewsOptions?.search,
            }),
          lc: getLocale(),
          tz: getTimezone(),
          profileId: this.options?.profileId,
        }),
      })

      if (!response.ok) {
        return null
      }

      try {
        const result = (await response.json()) as Partial<{
          replayId: unknown
          nextChunkIndex: unknown
        }>
        const resolvedReplayId = typeof result.replayId === 'string' && result.replayId ? result.replayId : replayId
        const resolvedChunkIndex =
          typeof result.nextChunkIndex === 'number' &&
          Number.isFinite(result.nextChunkIndex) &&
          result.nextChunkIndex >= 0
            ? Math.floor(result.nextChunkIndex)
            : 0

        return {
          replayId: resolvedReplayId,
          nextChunkIndex: resolvedChunkIndex,
        }
      } catch {
        return {
          replayId,
          nextChunkIndex: 0,
        }
      }
    } catch {
      return null
    }
  }

  private async sendSessionReplayChunk(
    replayId: string,
    privacy: SessionReplayPrivacy,
    chunkIndex: number,
    events: RrwebEvent[],
    useBeacon: boolean,
  ): Promise<boolean> {
    const apiBase = this.getApiBase()
    const url = `${apiBase}/log/session-replay/chunk`
    const payload = JSON.stringify({
      pid: this.projectID,
      replayId,
      privacy,
      chunkIndex,
      events,
    })

    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      // sendBeacon refuses payloads over its ~64 KB quota; fall through to
      // fetch when it does.
      const sent = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
      if (sent) return true
    }

    // On the beacon path the page is unloading, so there is no time to retry.
    const attempts = useBeacon ? 1 : SESSION_REPLAY_CHUNK_RETRY_DELAYS_MS.length + 1

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, SESSION_REPLAY_CHUNK_RETRY_DELAYS_MS[attempt - 1]))
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          // Browsers reject keepalive bodies over ~64 KB, so oversized
          // payloads go through a regular request instead.
          keepalive: useBeacon && payload.length < 60_000,
          body: payload,
        })

        if (response.ok) {
          return true
        }

        // Client errors (except timeouts and rate limits) won't succeed on
        // retry.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          return false
        }
      } catch {}
    }

    return false
  }

  private async sendRequest(path: string, body: object): Promise<void> {
    const host = this.options?.apiURL || DEFAULT_API_HOST
    const payload = JSON.stringify(body)
    await fetch(`${host}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Lets the request survive page unloads (e.g. tracking an outbound
      // link click). Browsers reject keepalive bodies over ~64 KB, so
      // oversized payloads fall back to a regular request.
      keepalive: payload.length < 60_000,
      body: payload,
    })
  }
}
