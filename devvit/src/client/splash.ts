import {requestExpandedMode} from '@devvit/web/client'
import {mountHexLife} from './hexlife.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

// The in-feed post view runs the real thing too (paused, with a play button) — the world IS the post,
// not a teaser for an expanded view.
void mountHexLife(mount, status)

const expandBtn = document.getElementById('expand-btn') as HTMLButtonElement
expandBtn.addEventListener('click', ev => requestExpandedMode(ev, 'game'))
