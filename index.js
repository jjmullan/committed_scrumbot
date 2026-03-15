require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');

// 날짜별 스레드 캐싱 (하루에 스레드 1개만 생성)
let dailyThreadCache = { date: '', threadId: '' };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

const SCRUM_QUESTIONS = [
  '😢 어제 완료하지 못한 업무',
  '🤔 오늘 해야 할 업무',
  '💡 공유하고 싶은 내용',
  '⏳ 업무 시작 및 종료 예정 시간',
  '⚡️ 컨디션 체크',
];

const scrumSessions = new Map(); // 진행 중인 세션

// 특정 유저에게 스크럼 DM 시작
async function startScrumForUser(user) {
  try {
    scrumSessions.set(user.id, { answers: [], user });
    await user.send(`
      안녕하세요, **${user.displayName}**님!\n${new Date().getMonth() + 1}월 ${new Date().getDate()}일 Daily Scrum 을 시작하겠습니다 😄\n\n${SCRUM_QUESTIONS[0]}`);
    console.log(`📨 ${user.displayName} 스크럼 시작`);
  } catch (err) {
    console.error(`❌ ${user.displayName}(${user.tag}) DM 전송 실패 (DM 차단 여부 확인):`, err.message);
  }
}

// 서버 전체 멤버에게 스크럼 시작
async function startDailyScrum() {
  console.log('🔔 Daily Scrum 시작!');

  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  // 전체 멤버 불러오기
  const members = await guild.members.fetch();

  for (const [, member] of members) {
    // Bot 제외
    if (member.user.bot) continue;
    await startScrumForUser(member.user);
  }
}

// 날짜별 스레드 조회 또는 생성
async function getOrCreateDailyThread(channel) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const threadName = `${today} Daily Scrum`;

  // 캐시에 오늘 날짜 스레드가 있으면 재사용
  if (dailyThreadCache.date === today) {
    try {
      const cachedThread = await client.channels.fetch(dailyThreadCache.threadId);
      if (cachedThread) return cachedThread;
    } catch {
      // 캐시된 스레드가 유효하지 않으면 새로 생성
    }
  }

  // 활성 스레드 목록에서 오늘 날짜 스레드 탐색
  const activeThreads = await channel.threads.fetchActive();
  const existing = activeThreads.threads.find((t) => t.name === threadName);
  if (existing) {
    dailyThreadCache = { date: today, threadId: existing.id };
    return existing;
  }

  // 없으면 새 스레드 생성 (포럼 채널은 message 파라미터 필수)
  const thread = await channel.threads.create({
    name: threadName,
    message: { content: `📋 **${threadName}** 스크럼 결과를 모아봅니다.` },
  });
  dailyThreadCache = { date: today, threadId: thread.id };
  console.log(`🧵 스레드 생성: ${threadName}`);
  return thread;
}

// 개별 응답 완료 시 스레드에 즉시 게시
async function postUserResult(username, answers) {
  const channel = await client.channels.fetch(process.env.SUMMARY_CHANNEL_ID);
  const thread = await getOrCreateDailyThread(channel);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🧑‍💻 ${username}`)
    .addFields(
      { name: '😢 어제 못한 일', value: answers[0] },
      { name: '🤔 오늘 할 일', value: answers[1] },
      { name: '💡 공유할 내용', value: answers[2] },
      { name: '⏳ 업무 시간', value: answers[3] },
      { name: '⚡️ 컨디션', value: answers[4] },
    )
    .setTimestamp();

  await thread.send({ embeds: [embed] });
  console.log(`📢 ${username} 스크럼 결과 스레드 게시 완료`);
}

// 미응답자 리마인더 DM 발송
async function sendReminders() {
  console.log('⏰ 미응답자 리마인더 DM 발송 시작');

  for (const [, session] of scrumSessions) {
    try {
      await session.user.send('⏰ 아직 Daily Scrum을 완료하지 않으셨어요! 잠시 시간 내어 답변해 주세요 😊');
      console.log(`⏰ ${session.user.displayName} 리마인더 DM 전송`);
    } catch (err) {
      console.error(`❌ ${session.user.displayName}(${(session, user.tag)}) 리마인더 DM 전송 실패:`, err.message);
    }
  }
}

// DM 답변 수신
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return;

  const userId = message.author.id;
  if (!scrumSessions.has(userId)) return;

  const session = scrumSessions.get(userId);
  session.answers.push(message.content);

  if (session.answers.length < SCRUM_QUESTIONS.length) {
    // 다음 질문 전송
    await message.channel.send(SCRUM_QUESTIONS[session.answers.length]);
  } else {
    // 완료 처리
    await message.channel.send(`✅ Daily Scrum 완료! 오늘도 화이팅입니다💪🏻`);

    scrumSessions.delete(userId);
    console.log(`✅ ${message.author.displayName} 스크럼 완료`);

    // 응답 완료 즉시 스레드에 게시
    try {
      await postUserResult(message.author.displayName, session.answers);
    } catch (err) {
      console.error(`❌ ${message.author.displayName} 스크럼 결과 게시 실패:`, err.message, err.code ?? '');
    }
  }
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} 로그인 성공!`);

  // 매일 오전 10시 자동 실행 (평일만, 한국 시간 KST)
  cron.schedule('0 10 * * 1-5', startDailyScrum, {
    timezone: 'Asia/Seoul',
  });

  /*
  // 매일 오후 2시 미응답자 리마인더 DM 발송 (평일만, 한국 시간 KST)
  cron.schedule('0 14 * * 1-5', sendReminders, {
    timezone: 'Asia/Seoul',
  });

  console.log('⏰ 스케줄러 등록 완료 (평일 오전 10시 스크럼 시작 / 오후 2시 리마인더)');
  */

  // ✅ 테스트용: 바로 스크럼 시작 (테스트 후 이 줄 삭제!)
  // startDailyScrum();
});

client.login(process.env.BOT_TOKEN);
