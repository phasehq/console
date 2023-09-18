'use client'

import { cryptoUtils } from '@/utils/auth'
import VerifyInvite from '@/graphql/queries/organisation/validateOrganisationInvite.gql'
import AcceptOrganisationInvite from '@/graphql/mutations/organisation/acceptInvite.gql'
import { useMutation, useQuery } from '@apollo/client'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import Loading from '@/app/loading'
import { useEffect, useState } from 'react'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { AccountSeedGen } from '@/components/onboarding/AccountSeedGen'
import { MdKey, MdOutlineVerifiedUser, MdOutlinePassword } from 'react-icons/md'
import { toast } from 'react-toastify'
import { OrganisationMemberInviteType } from '@/apollo/graphql'
import { useSession } from 'next-auth/react'
import { setLocalOrg } from '@/utils/localStorage'
import { Logo } from '@/components/common/Logo'

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
  const { data, loading } = useQuery(VerifyInvite, {
    variables: { inviteId: cryptoUtils.decodeInvite(params.invite) },
  })

  const [acceptInvite] = useMutation(AcceptOrganisationInvite)

  const { data: session } = useSession()

  const invite: OrganisationMemberInviteType = data?.validateInvite

  const [showWelcome, setShowWelcome] = useState<boolean>(true)
  const [step, setStep] = useState<number>(0)
  const [seedDownloaded, setSeedDownloaded] = useState<boolean>(false)
  const [success, setSuccess] = useState<boolean>(false)
  const [inputs, setInputs] = useState<Array<string>>([])
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [mnemonic, setMnemonic] = useState('')
  const [isloading, setIsLoading] = useState<boolean>(false)

  const steps: Step[] = [
    {
      index: 0,
      name: 'Set up recovery phrase',
      icon: <MdKey />,
      title: 'Recovery',
      description:
        "This is your 24 word recovery phrase. It's used to derive your account keys. Only you have access to it. Please write it down and store it somewhere safe like a password manager. You will need to enter your recovery phrase when logging in from a new device.",
    },
    {
      index: 1,
      name: 'Verify recovery phrase',
      icon: <MdOutlineVerifiedUser />,
      title: 'Verify recovery phrase',
      description: 'Please enter the your recovery phrase in the correct order below.',
    },
    {
      index: 2,
      name: 'Sudo password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'Please set up a strong sudo password to continue. This will be used to to perform administrative tasks and to secure your account keys.',
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
          inviteId: invite.id,
        },
      })

      try {
        setLocalOrg({
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

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const validateCurrentStep = () => {
    if (step === 1) {
      if (inputs.join(' ') !== mnemonic && !seedDownloaded) {
        errorToast('Incorrect account recovery key!')
        return false // TODO: UNCOMMENT THIS!!
      }
    } else if (step === 2) {
      if (pw !== pw2) {
        errorToast("Passwords don't match")
        return false
      }
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

  const skipSeedCheckerStep = () => {
    if (seedDownloaded) setStep(3)
  }

  useEffect(() => {
    setMnemonic(bip39.generateMnemonic(256))
    const id = crypto.randomUUID()
  }, [])

  useEffect(() => {
    setInputs([...Array(mnemonic.split(' ').length)].map(() => ''))
  }, [mnemonic])

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

                {step === 0 && <AccountSeedGen mnemonic={mnemonic} />}
                {step === 1 && (
                  <AccountSeedChecker
                    mnemonic={mnemonic}
                    inputs={inputs}
                    updateInputs={handleInputUpdate}
                    required={!seedDownloaded}
                  />
                )}
                {step === 2 && <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}

                <div className="flex justify-between w-full">
                  <div>
                    {step !== 0 && (
                      <Button variant="secondary" onClick={decrementStep} type="button">
                        Previous
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {seedDownloaded && step === 2 && (
                      <Button variant="secondary" type="button" onClick={skipSeedCheckerStep}>
                        Skip
                      </Button>
                    )}
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
