'use client'

import { HeroPattern } from '@/components/common/HeroPattern'
import { Button } from '@/components/common/Button'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { LogoMark } from '@/components/common/LogoMark'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@apollo/client'
import { MdKey, MdOutlinePassword } from 'react-icons/md'
import { FaArrowRight } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { setDevicePassword } from '@/utils/localStorage'
import { copyRecoveryKit, generateRecoveryPdf } from '@/utils/recovery'
import {
  organisationSeed,
  organisationKeyring,
  deviceVaultKey,
  encryptAccountKeyring,
  encryptAccountRecovery,
} from '@/utils/crypto'
import { InitAccountKeys } from '@/graphql/mutations/organisation/initAccountKeys.gql'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'

const bip39 = require('bip39')

export default function AccountInit() {
  const { activeOrganisation } = useContext(organisationContext)
  const { data: session } = useSession()
  const router = useRouter()

  const [initAccountKeys, { loading: mutationLoading }] = useMutation(InitAccountKeys)

  const [step, setStep] = useState(0)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [savePassword, setSavePassword] = useState(true)
  const [mnemonic, setMnemonic] = useState('')
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    setMnemonic(bip39.generateMnemonic(256))
  }, [])

  // If the user already has a keyring, redirect them away
  useEffect(() => {
    if (activeOrganisation && activeOrganisation.keyring) {
      router.push(`/${activeOrganisation.name}`)
    }
  }, [activeOrganisation, router])

  const steps: Step[] = [
    {
      index: 0,
      name: 'Sudo Password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'This will be used to encrypt your account keys. You may need to enter this password to unlock your workspace when logging in.',
    },
    {
      index: 1,
      name: 'Account recovery',
      icon: <MdKey />,
      title: 'Account Recovery',
      description:
        'If you forget your sudo password, you will need to use a recovery kit to regain access to your account.',
    },
  ]

  const computeAccountKeys = () => {
    return new Promise<{ publicKey: string; encryptedKeyring: string; encryptedMnemonic: string }>(
      (resolve) => {
        setTimeout(async () => {
          const accountSeed = await organisationSeed(mnemonic, activeOrganisation!.id)
          const accountKeyRing = await organisationKeyring(accountSeed)
          const deviceKey = await deviceVaultKey(pw, session?.user?.email!)
          const encryptedKeyring = await encryptAccountKeyring(accountKeyRing, deviceKey)
          const encryptedMnemonic = await encryptAccountRecovery(mnemonic, deviceKey)

          resolve({
            publicKey: accountKeyRing.publicKey,
            encryptedKeyring,
            encryptedMnemonic,
          })
        }, 1000)
      }
    )
  }

  const handleAccountInit = async () => {
    return new Promise<boolean>(async (resolve, reject) => {
      setIsLoading(true)
      try {
        const { publicKey, encryptedKeyring, encryptedMnemonic } = await computeAccountKeys()

        const { data } = await initAccountKeys({
          variables: {
            orgId: activeOrganisation!.id,
            identityKey: publicKey,
            wrappedKeyring: encryptedKeyring,
            wrappedRecovery: encryptedMnemonic,
          },
          refetchQueries: [{ query: GetOrganisations }],
        })

        const memberId = data?.updateMemberWrappedSecrets?.orgMember?.id
        if (memberId && savePassword) {
          setDevicePassword(memberId, pw)
        }

        setIsLoading(false)
        setSuccess(true)
        resolve(true)
      } catch (e) {
        setIsLoading(false)
        reject(e)
      }
    })
  }

  const validateCurrentStep = () => {
    if (step === 0) {
      if (pw !== pw2) {
        toast.error("Passwords don't match")
        return false
      }
    } else if (step === 1 && !recoveryDownloaded) {
      toast.error('Please download your account recovery kit!')
      return false
    }
    return true
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const isFormValid = validateCurrentStep()
    if (step !== steps.length - 1 && isFormValid) setStep(step + 1)
    if (step === steps.length - 1 && isFormValid) {
      toast
        .promise(handleAccountInit, {
          pending: 'Setting up your account keys',
          success: 'Account setup complete!',
        })
        .then(() => {
          router.push(`/${activeOrganisation!.name}`)
        })
    }
  }

  const decrementStep = () => {
    if (step !== 0) setStep(step - 1)
  }

  const handleDownloadRecoveryKit = async () => {
    toast
      .promise(
        generateRecoveryPdf(
          mnemonic,
          session?.user?.email!,
          activeOrganisation!.name,
          session?.user?.name || undefined
        ),
        {
          pending: 'Generating recovery kit',
          success: 'Downloaded recovery kit',
        }
      )
      .then(() => setRecoveryDownloaded(true))
  }

  const handleCopyRecoveryKit = () => {
    copyRecoveryKit(
      mnemonic,
      session?.user?.email!,
      activeOrganisation!.name,
      session?.user?.name || undefined
    )
    setRecoveryDownloaded(true)
  }

  if (!activeOrganisation) return null

  if (success) {
    return (
      <main className="w-full flex flex-col justify-between h-screen">
        <HeroPattern />
        <div className="mx-auto my-auto max-w-2xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
          <div className="flex flex-col gap-y-2 items-center">
            <h1 className="text-4xl text-black dark:text-white text-center font-bold">
              You&apos;re All Set
            </h1>
            <p className="text-black/30 dark:text-white/40 text-center">
              Your account keys have been set up. You can now access the console.
            </p>
            <div className="mx-auto pt-8">
              <Button
                variant="primary"
                iconPosition="right"
                icon={FaArrowRight}
                onClick={() => (window.location.href = `/${activeOrganisation.name}`)}
              >
                Go to Console
              </Button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="w-full flex flex-col justify-between h-screen">
      <HeroPattern />
      <div className="mx-auto my-auto w-full max-w-4xl flex flex-col gap-y-16 py-40">
        <form
          onSubmit={incrementStep}
          className="space-y-8 p-4 border border-violet-200/10 rounded-lg bg-zinc-100 dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
        >
          <div className="flex flex-col w-full">
            <div className="text-black dark:text-white font-semibold text-2xl text-center">
              <div className="flex justify-center pb-4">
                <LogoMark className="w-20 fill-black dark:fill-white" />
              </div>
              Set up your account
            </div>
            <p className="text-neutral-500 text-center text-sm mt-2">
              You&apos;ve been provisioned into{' '}
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {activeOrganisation.name}
              </span>
              . Complete these steps to secure your account.
            </p>
            <Stepper steps={steps} activeStep={step} />
          </div>

          {step === 0 && (
            <AccountPassword
              pw={pw}
              setPw={setPw}
              pw2={pw2}
              setPw2={setPw2}
              savePassword={savePassword}
              setSavePassword={setSavePassword}
            />
          )}

          {step === 1 && (
            <AccountRecovery
              mnemonic={mnemonic}
              onDownload={handleDownloadRecoveryKit}
              onCopy={handleCopyRecoveryKit}
            />
          )}

          <div className="flex justify-between w-full">
            <div>
              {step !== 0 && (
                <Button variant="secondary" onClick={decrementStep} type="button">
                  Previous
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                type="submit"
                isLoading={isLoading || mutationLoading}
                disabled={step === steps.length - 1 && !recoveryDownloaded}
              >
                {step === steps.length - 1 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}
