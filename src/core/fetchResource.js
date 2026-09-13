/**
 * Fetching jamin's own data files, wherever the page happens to be served from.
 *
 * `Response.ok` is true only for an HTTP status between 200 and 299 -- and a
 * response that did not come over HTTP has **no status at all**, which `fetch`
 * reports as `0`. Inside the plugin the page is served from a custom URL scheme
 * (`juce://`), so every one of these loads arrived complete and correct and was
 * then thrown away for failing a test it could never pass.
 *
 * The symptom was an empty phrase catalogue and no chord names, with no error
 * anywhere: the fetch succeeded, the bytes were right, and the `.ok` check
 * rejected them.
 *
 * So: a status of 0 means "this did not come over HTTP", not "this failed". A
 * real HTTP failure still has a real status and is still refused.
 */
export function resourceOk(response) {
  return response.ok || response.status === 0
}

/** Fetch one of our own bundled files, whatever scheme is serving it. */
export async function fetchResource(url) {
  const response = await fetch(url)
  if (!resourceOk(response)) {
    throw new Error(`${url} — ${response.status} ${response.statusText}`)
  }
  return response
}
