import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'

export const UpgradeRequestForm = (props: { onSuccess: Function }) => {
  const [useCase, setUseCase] = useState<string>('')

  const { data: session } = useSession()

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    const data = {
      email: session?.user?.email || '',
      useCase,
    }

    fetch(process.env.NEXT_PUBLIC_SLACK_NOTIF_URL!, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
      },
      body: JSON.stringify({
        origin: 'Phase console',
        action: 'Upgrade request',
        data,
      }),
    }).then((response) => {
      if (response.status === 200) {
        toast.success("Upgrade request submitted! We'll get back to you soon.")
        props.onSuccess()
      } else toast.error('Error submitting request. Please try again later.')
    })
  }

  return (
    <form className="grid md:grid-cols-2 gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col w-full justify-center md:col-span-2">
        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="usecase">
          Use case for Phase (optional)
        </label>
        <textarea
          id="usecase"
          maxLength={500}
          value={useCase}
          placeholder=""
          onChange={(e) => setUseCase(e.target.value)}
        />
      </div>

      <div className="flex w-full items-center justify-end md:col-span-2">
        <Button variant="primary" type="submit">
          Request upgrade
        </Button>
      </div>
    </form>
  )
}
