/**
 * Brand marks and display metadata for Agent harnesses and connection
 * services. The Cursor, Devin, OpenCode, and Claude marks are local copies of
 * the official logomarks from the phase.dev website (website repo,
 * `src/components/redesign/swiss/agent-icons.tsx`) — none of them ship in the
 * installed react-icons set (which only carries the Anthropic logogram for
 * Claude). All are flattened to `currentColor` so brand color comes from the
 * accompanying `iconClass`.
 */

import type { IconBaseProps, IconType } from 'react-icons'
import { FaGlobe, FaKey, FaRobot } from 'react-icons/fa'
import { SiAmazonwebservices, SiGithub, SiOpenai, SiPostgresql } from 'react-icons/si'
import { meshServiceLabel } from '@/components/agents/AgentMeshUtils'

/** Official Cursor cube mark — the 2D variant from the Cursor brand kit. */
export const SiCursor: IconType = (props: IconBaseProps) => (
  <svg viewBox="0 0 466.73 532.09" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      fill="currentColor"
      d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
    />
  </svg>
)

/** Official Devin (Cognition) ribbon mark. */
export const SiDevin: IconType = (props: IconBaseProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    fillRule="evenodd"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M2.033 9.867l2.554 1.483a.589.589 0 00.592 0l2.554-1.483.01-.008a.608.608 0 00.11-.084l.013-.015a.631.631 0 00.076-.1c.003-.005.008-.01.01-.016a.558.558 0 00.052-.125l.007-.028a.611.611 0 00.019-.14V7.868c0-.572.307-1.105.8-1.392a1.595 1.595 0 011.598 0l1.277.742a.54.54 0 00.129.053l.028.01c.044.01.088.015.133.016h.006l.013-.002a.587.587 0 00.27-.074l.011-.004 2.554-1.483a.596.596 0 00.297-.516V2.253a.595.595 0 00-.297-.516L12.293.257a.587.587 0 00-.591 0L9.148 1.737l-.01.01a.609.609 0 00-.109.083l-.014.015a.632.632 0 00-.076.1c-.003.005-.008.01-.01.016a.57.57 0 00-.052.124l-.007.028a.612.612 0 00-.018.14v1.483c0 .572-.307 1.105-.8 1.393a1.597 1.597 0 01-1.599 0l-1.276-.742a.603.603 0 00-.13-.053l-.028-.008a.658.658 0 00-.133-.018h-.02a.57.57 0 00-.269.074c-.003.002-.008.002-.012.005L2.033 5.872a.596.596 0 00-.297.515v2.966c0 .213.113.41.297.515z" />
    <path d="M15.943 10.607a1.596 1.596 0 011.599 0l1.276.74c.041.025.085.04.13.055l.028.008c.043.01.088.016.133.018h.005c.005 0 .01-.002.014-.003a.474.474 0 00.122-.016l.021-.005a.616.616 0 00.126-.052c.004-.002.009-.002.013-.005l2.554-1.482a.597.597 0 00.297-.516V6.383a.596.596 0 00-.297-.515l-2.552-1.483a.587.587 0 00-.592 0l-2.553 1.482-.011.008a.61.61 0 00-.108.084l-.014.016a.637.637 0 00-.076.1c-.003.005-.008.01-.01.016a.57.57 0 00-.052.124l-.007.029a.612.612 0 00-.018.14v1.482c0 .572-.307 1.105-.8 1.393a1.597 1.597 0 01-1.599 0l-1.276-.742a.584.584 0 00-.13-.053l-.028-.008a.62.62 0 00-.133-.018h-.02a.587.587 0 00-.269.074l-.012.004L9.15 10a.596.596 0 00-.296.516v2.966c0 .212.112.409.296.515l2.554 1.483s.008.002.012.005c.04.022.082.04.126.052l.02.004a.57.57 0 00.123.017l.014.002h.006c.054 0 .108-.01.16-.025a.587.587 0 00.13-.054l1.277-.741a1.597 1.597 0 012.398 1.392v1.482c0 .049.007.095.019.14l.007.028a.619.619 0 00.051.125c.004.006.008.01.01.016a.6.6 0 00.076.1l.014.015c.033.032.069.06.108.084.004.002.006.006.011.008l2.554 1.483a.59.59 0 00.593 0l2.554-1.483a.597.597 0 00.296-.516v-2.965a.595.595 0 00-.296-.516l-2.554-1.483s-.008-.002-.012-.005a.54.54 0 00-.126-.051c-.007-.003-.013-.003-.02-.005a.635.635 0 00-.125-.017h-.018a.557.557 0 00-.16.026.588.588 0 00-.13.053l-1.276.742a1.595 1.595 0 01-1.598 0 1.615 1.615 0 010-2.785l-.005-.001z" />
    <path d="M14.848 18.265l-2.554-1.482-.012-.005a.526.526 0 00-.126-.052c-.007-.002-.014-.002-.02-.005a.64.64 0 00-.124-.017h-.02a.56.56 0 00-.16.026.588.588 0 00-.13.053l-1.276.742a1.594 1.594 0 01-1.598 0c-.493-.286-.8-.82-.8-1.393V14.65a.563.563 0 00-.018-.14l-.008-.028a.604.604 0 00-.051-.124l-.01-.017a.603.603 0 00-.076-.1l-.014-.015a.596.596 0 00-.109-.084c-.003-.002-.005-.006-.01-.008L5.178 12.65a.587.587 0 00-.591 0l-2.554 1.483a.596.596 0 00-.297.516v2.965c0 .213.113.41.297.516l2.554 1.483.012.004a.618.618 0 00.267.074l.016.002h.007a.55.55 0 00.16-.026.584.584 0 00.129-.053l1.277-.742a1.597 1.597 0 012.398 1.393v1.482c0 .05.007.095.019.14l.007.028c.013.044.03.085.051.125l.01.016c.022.036.047.07.076.1l.014.015c.032.032.069.06.109.084l.01.008 2.554 1.483a.587.587 0 00.593 0l2.554-1.483a.596.596 0 00.296-.515v-2.966a.596.596 0 00-.296-.516h-.002z" />
  </svg>
)

/** Official OpenCode logomark (opencode.ai/brand) — the frame at full
 *  strength, the inner block at reduced opacity. */
export const SiOpenCode: IconType = (props: IconBaseProps) => (
  <svg viewBox="0 0 240 300" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path fill="currentColor" fillRule="evenodd" d="M240 300H0V0h240v300ZM180 60H60v180h120V60Z" />
    <path fill="currentColor" fillOpacity="0.4" d="M180 240H60V120h120v120Z" />
  </svg>
)

/** Official Claude starburst mark (Simple Icons "claude" — newer than the
 *  installed react-icons set). */
export const SiClaude: IconType = (props: IconBaseProps) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
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

/** Ordered as presented in pickers. Keys are the lowercase model values. */
export const AGENT_HARNESS_META: AgentBrandMeta[] = [
  { value: 'claude_code', label: 'Claude Code', Icon: SiClaude, iconClass: 'text-[#D97757]' },
  { value: 'codex', label: 'Codex', Icon: SiOpenai, iconClass: 'text-zinc-900 dark:text-zinc-100' },
  {
    value: 'cursor',
    label: 'Cursor',
    Icon: SiCursor,
    iconClass: 'text-zinc-900 dark:text-zinc-100',
  },
  { value: 'devin', label: 'Devin', Icon: SiDevin, iconClass: 'text-zinc-900 dark:text-zinc-100' },
  {
    value: 'opencode',
    label: 'OpenCode',
    Icon: SiOpenCode,
    iconClass: 'text-zinc-900 dark:text-zinc-100',
  },
  { value: 'other', label: 'Other', Icon: FaRobot, iconClass: 'text-neutral-500' },
]

const FALLBACK_HARNESS = AGENT_HARNESS_META[AGENT_HARNESS_META.length - 1]

export const agentHarnessMeta = (harnessType: string): AgentBrandMeta =>
  AGENT_HARNESS_META.find((meta) => meta.value === harnessType.toLowerCase()) || FALLBACK_HARNESS

export const AGENT_SERVICE_META: AgentBrandMeta[] = [
  { value: 'aws', label: 'AWS', Icon: SiAmazonwebservices, iconClass: 'text-[#FF9900]' },
  {
    value: 'github',
    label: 'GitHub',
    Icon: SiGithub,
    iconClass: 'text-zinc-900 dark:text-zinc-100',
  },
  { value: 'postgres', label: 'PostgreSQL', Icon: SiPostgresql, iconClass: 'text-[#4169E1]' },
  {
    value: 'openai',
    label: 'OpenAI',
    Icon: SiOpenai,
    iconClass: 'text-zinc-900 dark:text-zinc-100',
  },
  { value: 'litellm', label: 'LiteLLM', Icon: FaRobot, iconClass: 'text-violet-500' },
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
    iconClass: 'text-neutral-500',
  }
