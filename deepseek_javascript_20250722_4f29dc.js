// Webhook Manager (add to your bot code)
async function getWebhook(channel, character) {
  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.name === character.name);
  
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: character.name,
      avatar: character.avatarURL || null,
      reason: 'RP Character Proxy'
    });
  }
  
  return webhook;
}

// Message Handler (add to messageCreate event)
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  // Proxy message handling (when user types "message")
  if (message.content.startsWith('"') && activeProfiles.has(message.author.id)) {
    const character = await Character.findById(activeProfiles.get(message.author.id));
    if (!character) return;
    
    const webhook = await getWebhook(message.channel, character);
    
    // Delete original and send proxy
    await message.delete().catch(console.error);
    await webhook.send({
      content: message.content.slice(1),
      username: character.name,
      avatarURL: character.avatarURL || undefined
    });
  }
});