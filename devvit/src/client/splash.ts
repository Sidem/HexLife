import {requestExpandedMode} from '@devvit/web/client'
import {mountHexLife} from './hexlife.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

// In-feed post: quiet chrome; autoplay only when palette is flicker-proof (see hexlife.ts).
void mountHexLife(mount, status, {mode: 'feed'})

const expandBtn = document.getElementById('expand-btn') as HTMLButtonElement
expandBtn.addEventListener('click', ev => requestExpandedMode(ev, 'game'))
