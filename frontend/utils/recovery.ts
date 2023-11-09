import jsPDF from 'jspdf'
import { toast } from 'react-toastify'
import { copyToClipBoard } from './clipboard'

const PHASE_LOGO = `data:image/png;base64,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`

export const generateRecoveryPdf = async (
  mnemonic: string,
  email: string,
  organisation: string,
  name?: string
) => {
  const title = 'Phase Recovery Kit'
  const subtitle = `This is a recovery kit for your Phase account. \nYou can use this to recover your account keys if you forget your sudo password.`
  const hostname = `${window.location.protocol}//${window.location.host}`

  // Create a new jsPDF instance
  const pdf = new jsPDF()

  // Draw the black rectangle for the header
  pdf.setFillColor(0, 0, 0)
  pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), 60, 'F')

  // Set the title
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.text(title, 10, 25)

  // Set the subtitle
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'regular', '400')
  pdf.setFontSize(11)
  pdf.text(subtitle, 10, 35)

  // Add the logo
  const imgProps = pdf.getImageProperties(PHASE_LOGO)
  const imgWidth = 30
  const imgHeight = (imgProps.height * imgWidth) / imgProps.width // scale the height to maintain aspect ratio
  const pageWidth = pdf.internal.pageSize.getWidth()
  pdf.addImage(PHASE_LOGO, 'PNG', pageWidth - imgWidth - 10, 10, imgWidth, imgHeight)

  const lineSpace = 6
  const paragraphSpace = 12

  // Define cursor x and y starting positions
  let xPosition = 10
  let yPosition = 80

  //Name
  if (name) {
    pdf.setTextColor(115, 115, 115)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.text('Name', xPosition, yPosition)
    yPosition += lineSpace

    pdf.setTextColor(23, 23, 23)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(name, xPosition, yPosition)
    yPosition += paragraphSpace
  }

  //Email
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Email', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(email, xPosition, yPosition)
  yPosition += paragraphSpace

  //Org
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Organisation', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(organisation, xPosition, yPosition)
  yPosition += paragraphSpace

  //Phase instance host
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Login URL', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(hostname, xPosition, yPosition)
  yPosition += paragraphSpace * 2

  //Mnemonic
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Recovery phrase', xPosition, yPosition)
  yPosition += lineSpace

  // Define the size of the grid cells
  const cellWidth = pdf.internal.pageSize.getWidth() / 4
  const cellHeight = 10

  // Split the mnemonic into words
  const words = mnemonic.split(' ')

  // Loop over each word and place it in the PDF
  words.forEach((word, index) => {
    // Add the word number before the word
    pdf.setFontSize(14)
    pdf.setTextColor(23, 23, 23)
    pdf.setFont('helvetica', 'bold')
    pdf.text(word, xPosition, yPosition)

    // Increment the x position to the next column
    xPosition += cellWidth

    // If we've reached the end of a row, reset x and increment y
    if ((index + 1) % 4 === 0) {
      xPosition = 10
      yPosition += cellHeight
    }
  })

  yPosition += 10
  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Generated on ${new Date().toDateString()}`, 10, 280)

  // Save the PDF
  pdf.save(`phase-recovery-kit--${organisation}.pdf`)
}

export const copyRecoveryKit = async (
  mnemonic: string,
  email: string,
  organisation: string,
  name?: string
) => {
  const hostname = `${window.location.protocol}//${window.location.host}`

  const recoveryKit = `
  Phase Recovery Kit\n\n
  ${name ? `Name: ${name}` : ''}\n
  Email: ${email}\n
  Organsation: ${organisation}\n
  LoginUrl: ${hostname}\n
  Recovery phrase: ${mnemonic}\n
  Generated on ${new Date().toDateString()}
  `

  const copied = await copyToClipBoard(recoveryKit)
  copied ? toast.info('Copied to clipboard', { autoClose: 2000 }) : toast.error('Failed to copy')
}
