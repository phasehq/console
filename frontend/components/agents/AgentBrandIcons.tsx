// Cursor, OpenCode and Claude marks are copied from the phase.dev site; react-icons lacks them.

import type { IconBaseProps, IconType } from 'react-icons'
import { FaGlobe, FaKey, FaRobot } from 'react-icons/fa'
import {
  SiAmazonwebservices,
  SiCloudflare,
  SiGithub,
  SiGitlab,
  SiOpenai,
  SiPostgresql,
  SiRailway,
  SiRender,
  SiSupabase,
  SiVercel,
} from 'react-icons/si'
import { meshServiceLabel } from '@/components/agents/AgentMeshUtils'
import { LogoMark } from '@/components/common/LogoMark'

/** Official Cursor cube mark — the 2D variant from the Cursor brand kit. */
export const SiCursor: IconType = (props: IconBaseProps) => (
  <svg
    viewBox="0 0 466.73 532.09"
    width="1em"
    height="1em"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      fill="currentColor"
      d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
    />
  </svg>
)

/** The Phase mark, for a Connection to an app's own secrets. */
export const PhaseAppMark: IconType = (props: IconBaseProps) => (
  <LogoMark width="1em" height="1em" fill="currentColor" {...(props as object)} />
)

/** Official OpenCode logomark (opencode.ai/brand) — the frame at full
 *  strength, the inner block at reduced opacity. */
export const SiOpenCode: IconType = (props: IconBaseProps) => (
  <svg viewBox="0 0 240 300" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path fill="currentColor" fillRule="evenodd" d="M240 300H0V0h240v300ZM180 60H60v180h120V60Z" />
    <path fill="currentColor" fillOpacity="0.4" d="M180 240H60V120h120v120Z" />
  </svg>
)

/** Official Claude starburst mark (Simple Icons "claude" — newer than the
 *  installed react-icons set). */
export const SiClaude: IconType = (props: IconBaseProps) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
      fill="currentColor"
    />
  </svg>
)

export type AgentBrandMeta = {
  value: string
  label: string
  Icon: IconType
  /** Brand color; monochrome marks adapt to the theme. */
  iconClass: string
}

/** Marks without a brand colour: black in light theme, white in dark. */
export const MONOCHROME_MARK = 'text-zinc-900 dark:text-zinc-100'
/** Generic icons, for a harness or service without its own mark. */
export const GENERIC_MARK = 'text-neutral-500'

/** Ordered as presented in pickers. Keys are the lowercase model values. */
export const AGENT_HARNESS_META: AgentBrandMeta[] = [
  { value: 'claude_code', label: 'Claude Code', Icon: SiClaude, iconClass: 'text-[#D97757]' },
  { value: 'codex', label: 'Codex', Icon: SiOpenai, iconClass: MONOCHROME_MARK },
  {
    value: 'cursor',
    label: 'Cursor',
    Icon: SiCursor,
    iconClass: MONOCHROME_MARK,
  },
  {
    value: 'opencode',
    label: 'OpenCode',
    Icon: SiOpenCode,
    iconClass: MONOCHROME_MARK,
  },
  { value: 'other', label: 'Other', Icon: FaRobot, iconClass: GENERIC_MARK },
]

const FALLBACK_HARNESS = AGENT_HARNESS_META[AGENT_HARNESS_META.length - 1]

export const agentHarnessMeta = (harnessType: string): AgentBrandMeta =>
  AGENT_HARNESS_META.find((meta) => meta.value === harnessType.toLowerCase()) || FALLBACK_HARNESS

export function AgentHarnessTile({ harnessType }: { harnessType: string }) {
  const { Icon, iconClass } = agentHarnessMeta(harnessType)
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-500/10">
      <Icon aria-hidden="true" className={`size-5 ${iconClass}`} />
    </span>
  )
}

/** The tile names the service, since no badge repeats it. */
export function AgentServiceTile({ serviceType }: { serviceType: string }) {
  const { Icon, iconClass, label } = agentServiceMeta(serviceType)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-500/10"
    >
      <Icon aria-hidden="true" className={`size-5 ${iconClass}`} />
    </span>
  )
}

/** Services a Connection can actually bind to. Anything else falls back. */
export const AGENT_SERVICE_META: AgentBrandMeta[] = [
  { value: 'aws', label: 'AWS', Icon: SiAmazonwebservices, iconClass: 'text-[#FF9900]' },
  { value: 'postgres', label: 'PostgreSQL', Icon: SiPostgresql, iconClass: 'text-[#4169E1]' },
  // The marks match the ones the integration credentials already use.
  { value: 'github', label: 'GitHub', Icon: SiGithub, iconClass: MONOCHROME_MARK },
  { value: 'gitlab', label: 'GitLab', Icon: SiGitlab, iconClass: 'text-[#FC6D26]' },
  { value: 'cloudflare', label: 'Cloudflare', Icon: SiCloudflare, iconClass: 'text-[#F38020]' },
  { value: 'vercel', label: 'Vercel', Icon: SiVercel, iconClass: MONOCHROME_MARK },
  { value: 'render', label: 'Render', Icon: SiRender, iconClass: MONOCHROME_MARK },
  { value: 'railway', label: 'Railway', Icon: SiRailway, iconClass: MONOCHROME_MARK },
  { value: 'supabase', label: 'Supabase', Icon: SiSupabase, iconClass: 'text-[#3FCF8E]' },
  // A service the member defines: hosts and where the secret goes.
  { value: 'http', label: 'Custom HTTP', Icon: FaGlobe, iconClass: GENERIC_MARK },
  // An app's secrets, served by Phase itself.
  { value: 'phase_app', label: 'App secrets', Icon: PhaseAppMark, iconClass: MONOCHROME_MARK },
]

/** Semantic icons for credential/secret methods shown in method pickers. */
export const AGENT_CREDENTIAL_METHOD_ICONS: Record<string, IconType> = {
  app_secret: FaKey,
}

export const agentMethodIcon = (method: string): IconType =>
  AGENT_CREDENTIAL_METHOD_ICONS[method.toLowerCase()] || FaKey

export const agentServiceMeta = (serviceType: string): AgentBrandMeta =>
  AGENT_SERVICE_META.find((meta) => meta.value === serviceType.toLowerCase()) || {
    value: serviceType.toLowerCase(),
    label: meshServiceLabel(serviceType),
    Icon: FaGlobe,
    iconClass: GENERIC_MARK,
  }
