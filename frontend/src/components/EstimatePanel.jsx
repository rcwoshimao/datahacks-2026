import './EstimatePanel.css'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function EstimatePanel() {
  const [zip, setZip] = useState('')
  const navigate = useNavigate()

  return (
    <div className="estimatePanel">
      <label className="estimateLabel" htmlFor="zipcode">
        enter your zipcode
      </label>
      <input
        id="zipcode"
        className="estimateInput"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="e.g. 92101"
        value={zip}
        onChange={(e) => setZip(e.target.value)}
      />

      <button
        className="estimateButton"
        type="button"
        onClick={() => {
          // placeholder: wire up estimate action later
          const trimmed = zip.trim()
          navigate(trimmed ? `/page2?zip=${encodeURIComponent(trimmed)}` : '/page2')
          console.log('estimate', { zip })
        }}
      >
        estimate
      </button>

    </div>
  )
}

