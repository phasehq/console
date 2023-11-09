'use client'

import { cryptoUtils } from '@/utils/auth'
import VerifyInvite from '@/graphql/queries/organisation/validateOrganisationInvite.gql'
import AcceptOrganisationInvite from '@/graphql/mutations/organisation/acceptInvite.gql'
import { useLazyQuery, useMutation } from '@apollo/client'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import Loading from '@/app/loading'
import { useEffect, useState } from 'react'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { MdKey, MdOutlinePassword } from 'react-icons/md'
import { toast } from 'react-toastify'
import { OrganisationMemberInviteType } from '@/apollo/graphql'
import { useSession } from 'next-auth/react'
import { setLocalKeyring } from '@/utils/localStorage'
import { Logo } from '@/components/common/Logo'
import { copyRecoveryKit, generateRecoveryPdf } from '@/utils/recovery'

const bip39 = require('bip39')

const errorToast = (message: string) => {
  toast.error(message)
}

const InvalidInvite = () => (
  <div className="mx-auto my-auto max-w-xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
    <div className="space-y-2">
      <h1 className="font-bold text-3xl">Something went wrong</h1>
      <p className="text-lg text-neutral-500">
        This invite cannot be used by you. Please check that you are logged in to the correct
        account, or contact the organisation owner to create a new invite.
      </p>
    </div>
  </div>
)

export default function Invite({ params }: { params: { invite: string } }) {
  const [verifyInvite, { data, loading }] = useLazyQuery(VerifyInvite)

  const [acceptInvite] = useMutation(AcceptOrganisationInvite)

  const { data: session } = useSession()

  const invite: OrganisationMemberInviteType = data?.validateInvite

  const [showWelcome, setShowWelcome] = useState<boolean>(true)
  const [step, setStep] = useState<number>(0)
  const [recoverySkipped, setRecoverySkipped] = useState<boolean>(false)
  const [recoveryDownloaded, setRecoveryDownloaded] = useState<boolean>(false)
  const [success, setSuccess] = useState<boolean>(false)
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [mnemonic, setMnemonic] = useState('')
  const [isloading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    const handleVerifyInvite = async () => {
      const inviteId = await cryptoUtils.decodeb64string(params.invite)

      await verifyInvite({
        variables: { inviteId },
      })
    }

    if (params.invite) handleVerifyInvite()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.invite])

  const steps: Step[] = [
    {
      index: 0,
      name: 'Sudo Password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'This will be used to encrypt your account keys. You will be need to enter this password to perform administrative tasks.',
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
          const accountSeed = await cryptoUtils.organisationSeed(mnemonic, invite.organisation.id)

          const accountKeyRing = await cryptoUtils.organisationKeyring(accountSeed)

          const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)

          const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(
            accountKeyRing,
            deviceKey
          )

          const encryptedMnemonic = await cryptoUtils.encryptAccountRecovery(mnemonic, deviceKey)

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
      const { publicKey, encryptedKeyring, encryptedMnemonic } = await computeAccountKeys()

      const { data } = await acceptInvite({
        variables: {
          orgId: invite.organisation.id,
          identityKey: publicKey,
          wrappedKeyring: encryptedKeyring,
          wrappedRecovery: encryptedMnemonic,
          inviteId: invite.id,
        },
      })

      try {
        setLocalKeyring({
          email: session?.user?.email!,
          org: invite.organisation,
          keyring: encryptedKeyring,
          recovery: encryptedMnemonic,
        })
      } catch (e) {
        setIsLoading(false)
        reject()
      }

      setIsLoading(false)
      if (data.createOrganisationMember.orgMember.id) {
        setSuccess(true)
        resolve(true)
      } else {
        reject()
      }
    })
  }

  const validateCurrentStep = () => {
    if (step === 0) {
      if (pw !== pw2) {
        errorToast("Passwords don't match")
        return false
      }
    } else if (step === 1 && !recoveryDownloaded) {
      errorToast('Please download the your account recovery kit!')
      return false
    }
    return true
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    const isFormValid = validateCurrentStep()
    if (step !== steps.length - 1 && isFormValid) setStep(step + 1)
    if (step === steps.length - 1 && isFormValid) {
      toast.promise(handleAccountInit, {
        pending: 'Setting up your account',
        success: 'Account setup complete!',
      })
    }
  }

  const decrementStep = () => {
    if (step !== 0) setStep(step - 1)
  }

  useEffect(() => {
    setMnemonic(bip39.generateMnemonic(256))
    const id = crypto.randomUUID()
  }, [])

  const WelcomePane = () => (
    <div className="mx-auto my-auto max-w-2xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
      <div className="space-y-2">
        <div className="flex justify-center">
          <Logo boxSize={80} />
        </div>

        <h1 className="font-bold text-3xl">Welcome to Phase</h1>
        <p className="text-lg text-neutral-500">
          You have been invited by{' '}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {invite.invitedBy.email}
          </span>{' '}
          to join the{' '}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {invite.organisation.name}
          </span>{' '}
          organisation.
        </p>
      </div>
      <Button variant="primary" onClick={() => setShowWelcome(false)}>
        Join <FaArrowRight />
      </Button>
    </div>
  )

  const SuccessPane = () => {
    return (
      <div className="mx-auto my-auto max-w-2xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
        <div className="flex flex-col gap-y-2 items-center">
          <h1 className="text-4xl text-black dark:text-white text-center font-bold">Success!</h1>
          <p className="text-black/30 dark:text-white/40 text-center">Your account is setup!</p>
          <div className="mx-auto pt-8">
            <Button
              variant="primary"
              arrow="right"
              onClick={() => (window.location.href = `/${invite.organisation.name}`)}
            >
              Go to Console
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const handleDownloadRecoveryKit = async () => {
    toast
      .promise(
        generateRecoveryPdf(
          mnemonic,
          session?.user?.email!,
          invite.organisation.name,
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
      invite.organisation.name,
      session?.user?.name || undefined
    )
  }

  return (
    <>
      <div>
        <HeroPattern />

        <div className="flex w-full h-screen max-w-4xl mx-auto flex-col gap-y-16 py-40">
          {loading ? (
            <Loading />
          ) : invite ? (
            showWelcome ? (
              <WelcomePane />
            ) : success ? (
              <SuccessPane />
            ) : (
              <form
                onSubmit={incrementStep}
                className="space-y-16 p-8 border border-violet-200/10 rounded-lg bg-neutral-100 dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
              >
                <div className="flex flex-col w-full">
                  <Stepper steps={steps} activeStep={step} />
                </div>

                {step === 0 && <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}

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
                    <Button variant="primary" type="submit" isLoading={isloading}>
                      Next
                    </Button>
                  </div>
                </div>
              </form>
            )
          ) : (
            <InvalidInvite />
          )}
        </div>
      </div>
    </>
  )
}
