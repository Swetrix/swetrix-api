import Billing from 'pages/Billing'
import type { SitemapFunction } from 'remix-sitemap'

export const sitemap: SitemapFunction = () => ({
  exclude: true,
})

export default function Index() {
  return <Billing />
}
