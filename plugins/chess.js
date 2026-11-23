var {Module} = require('../lib/plugins');
const axios = require('axios');
const sharp = require('sharp');
const { Chess } = require('chess.js');

const rooms = new Map();
const pieces = {
    wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
    bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
};

function getName(jid) {
    return jid.split('@')[0];
}

function getMove(input) {
    return input.replace(/[\s-]/g, '').toLowerCase();
}

function getPlayer(room, jid) {
    if (room.players.white === jid) return 'White';
    if (room.players.black === jid) return 'Black';
    return null;
}

const api = 'https://www.mzazi.shop/api/games/chess-puzzle';
const x_key = 'YOUR_API_KEY';
async function getPuzzle() {
    const { data } = await axios.get(api, {
        params: { apikey: x_key },
        timeout: 30000
    });
    if (data?.status === false || !data?.result?.id) {
        throw new Error('Could not get a puzzle');
    }

    const id = data.result.id;
    const { data: lichess } = await axios.get(
        `https://lichess.org/api/puzzle/${id}`,
        {
            headers: {
                'User-Agent': 'WhatsAppChessBot/1.0',
                Accept: 'application/json'
            },
            timeout: 30000
        }
    );
    if (!lichess?.game?.pgn || !Number.isInteger(lichess?.puzzle?.initialPly)) {
        throw new Error('Could not retrieve the puzzle position');
    }
    const board = new Chess();
    board.loadPgn(lichess.game.pgn);
    if (board.history().length < lichess.puzzle.initialPly) {
        throw new Error('Invalid puzzle position');
    }

    while (board.history().length > lichess.puzzle.initialPly) {
        board.undo();
    }

    return {
        id,
        board,
        rating: lichess.puzzle.rating,
        plays: lichess.puzzle.plays
    };
}

async function makeBoard(room) {
    const board = room.board.board();
    const last = room.lastMove;
    const size = 800;
    const cell = 100;
    let svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#202b24"/>
    `;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = String.fromCharCode(97 + col) + (8 - row);
            const item = board[row][col];
            const light = (row + col) % 2 === 0;
            let color = light ? '#eeeed2' : '#769656';
            if (last && (last.from === square || last.to === square)) {
                color = '#baca44';
            }
            const x = col * cell;
            const y = row * cell;
            svg += `
            <rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color}"/>
            `;
            if (item) {
                const symbol = pieces[item.color + item.type];
                const fill = item.color === 'w' ? '#ffffff' : '#171d18';
                const stroke = item.color === 'w' ? '#333333' : '#ffffff';
                svg += `
                <text x="${x + 50}" y="${y + 72}"
                    text-anchor="middle"
                    font-size="76"
                    font-family="DejaVu Sans, Arial, sans-serif"
                    fill="${fill}"
                    stroke="${stroke}"
                    stroke-width="1"
                    paint-order="stroke">${symbol}</text>
                `;
            }

            if (col === 0) {
                svg += `
                <text x="${x + 5}" y="${y + 17}"
                    font-size="14"
                    font-weight="bold"
                    fill="${light ? '#769656' : '#eeeed2'}">${8 - row}</text>
                `;
            }

            if (row === 7) {
                svg += `
                <text x="${x + 88}" y="${y + 94}"
                    font-size="14"
                    font-weight="bold"
                    fill="${light ? '#769656' : '#eeeed2'}">${String.fromCharCode(97 + col)}</text>
                `;
            }
        }
    }

    svg += '</svg>';
    return sharp(Buffer.from(svg)).png().toBuffer();
}

async function sendBoard(message, room, caption) {
    const image = await makeBoard(room);
    return message.send({
        image,
        caption
    });
}

function getCaption(room, extra = '') {
    const turn = room.board.turn() === 'w' ? 'White' : 'Black';

    return `♟️ *CHESS*

*Player 1:* ${getName(room.players.white)}
*Player 2:* ${getName(room.players.black)}

*White:* ${getName(room.players.white)}
*Black:* ${getName(room.players.black)}

*Rating:* ${room.rating}
*Puzzle:* ${room.id}

${extra}

*Turn:* ${turn}
Send your move directly
Example: e2e4

.chess board - Show board
.chess quit - End game`;
}

async function startRoom(message, room) {
    try {
        const puzzle = await getPuzzle();
        room.board = puzzle.board;
        room.rating = puzzle.rating;
        room.plays = puzzle.plays;
        room.id = puzzle.id;
        room.status = 'playing';
        room.lastMove = null;
        const first = room.board.turn() === 'w' ? 'White' : 'Black';
        return sendBoard(
            message,
            room,
            getCaption(room, `Game started!\n${first} plays first.`)
        );

    } catch (error) {
        console.error(error.response?.data || error.message);
        rooms.delete(room.group);
        return message.send('Could not start the chess game. Try again');
    }
}

    Module({
  command: 'chess',
  package: 'games',
  description: 'Play multiplayer chess',
})(async (message, match) => {      
    try {
        const group = message.from;
        const sender = message.sender;
        if (!group?.endsWith('@g.us')) {
            return message.send('Chess is only available in group chats');
        }
        if (!sender || sender === group) {
            return message.send('Could not identify the player');
        }

        const input = String(
            match || message.body?.split(/\s+/).slice(1).join(' ') || ''
        ).trim().toLowerCase();
        let room = rooms.get(group);
        if (input === 'join') {
            if (!room) {
                return message.send('There is no chess room. Type .chess to create one');
            }

            if (room.status !== 'waiting') {
                return message.send('This chess game has already started');
            }

            if (room.players.white === sender) {
                return message.send('You already created this room');
            }

            if (room.players.black) {
                return message.send('This chess room is already full');
            }

            room.players.black = sender;
            return startRoom(message, room);
        }

        if (input === 'board') {
            if (!room || room.status !== 'playing') {
                return message.send('There is no active chess game');
            }
            if (!getPlayer(room, sender)) {
                return message.send('You are not part of this chess game');
            }

            return sendBoard(message, room, getCaption(room));
        }

        if (input === 'quit' || input === 'exit') {
            if (!room) {
                return message.send('There is no active chess room');
            }

            if (room.players.white !== sender && room.players.black !== sender) {
                return message.send('You are not part of this chess game');
            }

            rooms.delete(group);
            return message.send('Chess game ended');
        }

        if (input === 'start') {
            if (!room || room.status !== 'waiting') {
                return message.send('No waiting chess room');
            }
            if (room.players.white !== sender) {
                return message.send('Only the room creator can start the game');
            }
            if (!room.players.black) {
                return message.send('Waiting for Player 2. Use .chess join to join');
            }
            return startRoom(message, room);
        }
        if (room) {
            return message.send('A chess room already exists. Use .chess join to join it');
        }

        room = {
            group,
            host: sender,
            players: {
                white: sender,
                black: null
            },
            status: 'waiting'
        };

        rooms.set(group, room);

        return message.send(
            `♟️ *CHESS ROOM CREATED*

*Player 1:* ${getName(sender)}

Waiting for Player 2.

Another member must type:
*.chess join*

_The game starts automatically_`
        );

    } catch (error) {
        console.error(error.response?.data || error.message);

        return message.send('Could not process chess command');
    }
});

Module({
    on: 'text'
})(async({ message }) => {
    try {
        const group = message.from;
        const sender = message.sender;
        if (!group?.endsWith('@g.us') || !sender) return;
        const room = rooms.get(group);
        if (!room || room.status !== 'playing') return;
        const input = String(message.body || '').trim().toLowerCase();
        if (!input || input.startsWith('.')) return;
        const move = getMove(input);
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
        const player = getPlayer(room, sender);
        if (!player) return;
        const turn = room.board.turn() === 'w' ? 'White' : 'Black';
        if (player !== turn) {
            return message.send(`It is ${turn}'s turn`);
        }

        let result;
        try {
            result = room.board.move({
                from: move.slice(0, 2),
                to: move.slice(2, 4),
                promotion: move[4] || 'q'
            });
        } catch (error) {
            return message.send('Illegal move. Try another move');
        }

        if (!result) {
            return message.send('Illegal move. Try another move');
        }

        room.lastMove = {
            from: result.from,
            to: result.to
        };

        if (room.board.isGameOver()) {
            let outcome = 'Game over.';

            if (room.board.isCheckmate()) {
                const winner = room.board.turn() === 'w' ? 'Black' : 'White';
                outcome = `Checkmate! ${winner} wins!`;

            } else if (room.board.isStalemate()) {
                outcome = 'Draw by stalemate';

            } else if (room.board.isThreefoldRepetition()) {
                outcome = 'Draw by threefold repetition';

            } else if (room.board.isInsufficientMaterial()) {
                outcome = 'Draw by insufficient material';

            } else if (room.board.isDraw()) {
                outcome = 'The game is a draw';
            }

            const caption = getCaption(room, outcome);

            rooms.delete(group);

            return sendBoard(message, room, caption);
        }

        const next = room.board.turn() === 'w' ? 'White' : 'Black';

        return sendBoard(
            message,
            room,
            getCaption(room, `${player} played ${result.san}.\n\n${next}, your turn.`)
        );

    } catch (error) {
        console.error( error.response?.data || error.message);
    }
});
        
