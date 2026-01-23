/* window.js
 *
 * Copyright 2026 Unknown
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GObject from 'gi://GObject';
import Adw from 'gi://Adw';

import { populateAppList } from './appsList.js';

export const TerminatorWindow = GObject.registerClass({
    GTypeName: 'TerminatorWindow',
    Template: 'resource:///org/ramez/terminator/window.ui',
    InternalChildren: ['appsListBox'],
}, class TerminatorWindow extends Adw.ApplicationWindow {
    constructor(application) {
        super({ application });
        populateAppList(this._appsListBox);
    }
});

