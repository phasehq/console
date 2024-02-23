import Link from 'next/link'
import { FaArrowRight } from 'react-icons/fa'
import {
  SiDjango,
  SiDotnet,
  SiFastapi,
  SiFlask,
  SiGatsby,
  SiGo,
  SiLaravel,
  SiNestjs,
  SiNextdotjs,
  SiNodedotjs,
  SiNuxtdotjs,
  SiReact,
  SiRemix,
  SiRubyonrails,
  SiSvelte,
  SiVuedotjs,
} from 'react-icons/si'
import { Card } from '../common/Card'

export const FrameworkIntegrations = () => {
  const frameworks = [
    {
      href: '/integrations/frameworks/react',
      name: 'React',
      description: 'Inject secrets and environment variables to your React app.',
      logo: <SiReact className="shrink-0 text-[#61DAFB]" />,
    },
    {
      href: '/integrations/frameworks/node',
      name: 'Node.js',
      description: 'Inject secrets and environment variables to your Node.js app.',
      logo: <SiNodedotjs className="shrink-0 text-[#339933]" />,
    },
    {
      href: '/integrations/frameworks/next-js',
      name: 'Next.js',
      description: 'Inject secrets and environment variables to your Next.js app.',
      logo: <SiNextdotjs className="shrink-0 text-black dark:text-white" />,
    },
    {
      href: '/integrations/frameworks/django',
      name: 'Django',
      description: 'Inject secrets and environment variables to your Django app.',
      logo: <SiDjango className="shrink-0 text-[#092E20]" />,
    },
    {
      href: '/integrations/frameworks/fiber',
      name: 'Golang',
      description: 'Inject secrets and environment variables to your Go app.',
      logo: <SiGo className="shrink-0 text-[#00ADD8]" />,
    },
    {
      href: '/integrations/frameworks/ruby-on-rails',
      name: 'Ruby on Rails',
      description: 'Inject secrets and environment variables to your Ruby on Rails app.',
      logo: <SiRubyonrails className="shrink-0 text-[#D30001]" />,
    },
    {
      href: '/integrations/frameworks/dotnet',
      name: '.NET',
      description: 'Inject secrets and environment variables to your .NET app.',
      logo: <SiDotnet className="shrink-0 text-[#512BD4]" />,
    },
    {
      href: '/integrations/frameworks/laravel',
      name: 'Laravel',
      description: 'Inject secrets and environment variables to your Laravel app.',
      logo: <SiLaravel className="shrink-0 text-[#FF2D20]" />,
    },
    {
      href: '/integrations/frameworks/vue-js',
      name: 'Vue',
      description: 'Inject secrets and environment variables to your Vue app.',
      logo: <SiVuedotjs className="shrink-0 text-[#4FC08D]" />,
    },
    {
      href: '/integrations/frameworks/nuxt',
      name: 'Nuxt',
      description: 'Inject secrets and environment variables to your Nuxt app.',
      logo: <SiNuxtdotjs className="shrink-0 text-[#00DC82]" />,
    },
    {
      href: '/integrations/frameworks/nest-js',
      name: 'NestJS',
      description: 'Inject secrets and environment variables to your NestJS app.',
      logo: <SiNestjs className="shrink-0 text-[#E0234E]" />,
    },
    {
      href: '/integrations/frameworks/fast-api',
      name: 'FastAPI',
      description: 'Inject secrets and environment variables to your FastAPI app.',
      logo: <SiFastapi className="shrink-0 text-[#009688]" />,
    },
    {
      href: '/integrations/frameworks/flask',
      name: 'Flask',
      description: 'Inject secrets and environment variables to your Flask app.',
      logo: <SiFlask className="shrink-0 text-black dark:text-white" />,
    },
    {
      href: '/integrations/frameworks/svelte',
      name: 'Svelte',
      description: 'Inject secrets and environment variables to your Svelte app.',
      logo: <SiSvelte className="shrink-0 text-[#FF3E00]" />,
    },
    {
      href: '/integrations/frameworks/gatsby',
      name: 'Gatsby',
      description: 'Inject secrets and environment variables to your Gatsby app.',
      logo: <SiGatsby className="shrink-0 text-[#663399]" />,
    },
    {
      href: '/integrations/frameworks/remix',
      name: 'Remix',
      description: 'Inject secrets and environment variables to your Gatsby app.',
      logo: <SiRemix className="shrink-0 text-black dark:text-white" />,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:max-w-none xl:grid-cols-4">
      {frameworks.map((framework) => (
        <Card key={framework.name}>
          <Link
            href={`https://docs.phase.dev${framework.href}`}
            target="_blank"
            className="flex flex-row-reverse gap-6"
          >
            <div className="flex-auto">
              <h3 className=" font-semibold text-zinc-900 dark:text-white">{framework.name}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {framework.description}
              </p>
              <div className="mt-4 flex items-center gap-1 text-sm">
                <div className="flex items-center text-emerald-500">Explore</div>
                <FaArrowRight className="text-emerald-500 text-xs" />
              </div>
            </div>
            <div className="text-3xl">{framework.logo}</div>
          </Link>
        </Card>
      ))}
    </div>
  )
}
