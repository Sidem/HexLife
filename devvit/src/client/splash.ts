import {requestExpandedMode} from '@devvit/web/client'
import {mountHexLife} from './hexlife.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

// The in-feed post view runs the real thing too — the Phase 1 acceptance criterion is a world
// animating *in the post*, not only in expanded mode.
mountHexLife(mount, status)

const expandBtn = document.getElementById('expand-btn') as HTMLButtonElement
expandBtn.addEventListener('click', ev => requestExpandedMode(ev, 'game'))
