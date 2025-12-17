import { JoinClient } from './JoinClient'

export default function JoinPage({
  searchParams,
}: {
  searchParams?: { token?: string | string[] }
}) {
  const token =
    typeof searchParams?.token === 'string'
      ? searchParams.token
      : Array.isArray(searchParams?.token)
        ? searchParams?.token?.[0] ?? null
        : null

  return <JoinClient token={token} />
}
