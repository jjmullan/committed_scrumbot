require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

const SCRUM_QUESTIONS = [
  '😢 어제 완료하지 못한 일을 작성해주세요',
  '🤔 오늘 해야 할 일을 작성해주세요.',
  '💡 공유하고 싶은 내용이 있다면 작성해주세요.',
  '⚡️ 컨디션 체크',
];

const scrumSessions = new Map(); // 진행 중인 세션
const scrumResults = new Map(); // 완료된 답변 모음

// 특정 유저에게 스크럼 DM 시작
async function startScrumForUser(user) {
  try {
    scrumSessions.set(user.id, { answers: [], user });
    await user.send(`
      안녕하세요, ${user.tag}님!\n${new Date().getMonth() + 1}월 ${new Date().getDate()}일 Daily Scrum 을 시작하겠습니다😄\n\n**${SCRUM_QUESTIONS[0]}**`);
    console.log(`📨 ${user.tag} 스크럼 시작`);
  } catch (err) {
    console.error(`❌ ${user.tag} DM 전송 실패 (DM 차단 여부 확인):`, err.message);
  }
}

// 서버 전체 멤버에게 스크럼 시작
async function startDailyScrum() {
  console.log('🔔 Daily Scrum 시작!');

  // 결과 초기화
  scrumResults.clear();

  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  // 전체 멤버 불러오기
  const members = await guild.members.fetch();

  for (const [, member] of members) {
    // Bot 제외
    if (member.user.bot) continue;
    await startScrumForUser(member.user);
  }

  // 30분 후 미응답자 포함해서 채널에 요약 게시
  setTimeout(postSummary, /* 30 *  */ 60 * 1_000);
}

// 채널에 요약 게시
async function postSummary() {
  const channel = await client.channels.fetch(process.env.SUMMARY_CHANNEL_ID);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // 결과가 없으면 안내 메시지
  if (scrumResults.size === 0) {
    await channel.send(`
      🗓️ ${new Date().getMonth() + 1}월 ${new Date().getDate()}일 Daily Scrum 요약\n\n오늘 응답한 멤버가 없습니다.`);
    return;
  }

  // 각 멤버별 결과 Embed 생성
  for (const [, result] of scrumResults) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🧑‍💻 ${result.username}`)
      .setDescription(`📅 ${today} Daily Scrum`)
      .addFields(
        { name: '😢 어제 한 일', value: result.answers[0] || '미응답' },
        { name: '🤔 오늘 할 일', value: result.answers[1] || '미응답' },
        { name: '💡 공유할 내용', value: result.answers[2] || '미응답' },
        { name: '⚡️ 컨디션', value: result.answers[3] || '미응답' },
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  console.log('📢 스크럼 요약 채널 게시 완료');
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

    // 결과 저장
    scrumResults.set(userId, {
      username: message.author.username,
      answers: session.answers,
    });

    scrumSessions.delete(userId);
    console.log(`✅ ${message.author.tag} 스크럼 완료`);
  }
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} 로그인 성공!`);

  // 매일 오전 10시 자동 실행 (한국 시간 KST)
  cron.schedule('0 10 * * *', startDailyScrum, {
    timezone: 'Asia/Seoul',
  });

  console.log('⏰ 스케줄러 등록 완료 (매일 오전 10시)');

  // ✅ 테스트용: 바로 스크럼 시작 (테스트 후 이 줄 삭제!)
  startDailyScrum();
});

client.login(process.env.BOT_TOKEN);
