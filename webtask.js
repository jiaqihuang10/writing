'use latest';
const boilerplate = require("@saasquatch/program-boilerplate");
const emailQuery = boilerplate.rewardEmailQuery;
let referrerRewardKeys = ["referrerReward"];

function getReferrerRewardCount(referrerUser, referrerRewardKeys) {
    const referrerRewards = (referrerUser.rewards.data).filter(v => (referrerRewardKeys.includes(v.programRewardKey)));
    return referrerRewards.length;
}

//return bool value - if the purchase value of the user beyond min purhase value count as conversion
//revenue in event
function meetPurchaseMin(events, ruleMinValue) {
    return events.some( event => {
        return (event.key === 'purchase' && event.fields.revenue && event.fields.revenue >= parseValue(ruleMinValue)) || (event.key === 'purchase' && !event.fields.revenue && ruleMinValue === 0)
    })
}

function meetPurchaseCondition(events,rules) {
    switch (rules.conversionRules.selectedRule) {
        case "firstPurchase":
            const ruleMinValue = rules.conversionRules.firstPurchaseSetting ? rules.conversionRules.firstPurchaseSetting.minPurchaseValue : 0;
            return meetPurchaseMin(events,ruleMinValue);
        default:
            return true;
    }
}

function fireProgramEvalAnalytics (transaction, user) {
    const evalAnalytic = {
       "eventType": "PROGRAM_EVALUATED",
       "data": {
         "user": {
           "id": user.id,
           "accountId": user.accountId
         }
       }
   };
   transaction.pushAnalytics(evalAnalytic);
}

function shouldRewardReferreD (transaction) {
    console.log("checking referred");
    const currentUser = transaction.context.body.activeTrigger.user;
    const rules = transaction.context.body.program.rules;

    if (!rules) { console.log("no rule"); return false; }

    if (!currentUser) { console.log("no user"); return false; }

    if (!rules.programRewardRules.rewardReferred.rewardReferredUser) {console.log("do not reward referrED"); return false;}

    const referral = currentUser.referredByReferral;

    if (!referral) {console.log("no referral"); return false;}

    //if the current user has not been rewarded as referred, it should be rewarded
    if (referral.rewards.length > 0) { console.log("referred already rewarded"); return false;}

    const events = transaction.context.body.activeTrigger.events;
    if (events) { //if it's a event trigger
        const ruleMinValue = rules.conversionRules.firstPurchaseSetting ? rules.conversionRules.firstPurchaseSetting.minPurchaseValue : 0;
        if (!meetPurchaseMin(events, ruleMinValue)) { console.log("not converted"); return false}
    }
    return true;
}

function shouldRewardReferreR (transaction) {
    console.log("checking referrer");
    const currentUser = transaction.context.body.activeTrigger.user;
    const rules = transaction.context.body.program.rules;

    if (!rules) {console.log("no rule"); return false;}

    if (!currentUser) { console.log("no user");return false;}

    const referral = currentUser.referredByReferral;

    if (referral === null) { console.log("no referral"); return false;}

    const referrer = referral.referrerUser;
    const referralId = referral.id;
    const referrerRewards = referrer.rewards.data;

     const events = transaction.context.body.activeTrigger.events;
    if (events) { //if it's a event trigger
      //check if referred user converted
      const ruleMinValue = rules.conversionRules.firstPurchaseSetting ? rules.conversionRules.firstPurchaseSetting.minPurchaseValue : 0;
      if (!meetPurchaseMin(events, ruleMinValue)) { console.log("not converted"); return false}
    }

    //check if referrer hits reward limit
    const maxRewardNumberRule = rules.programRewardRules.maxRewardNumber;

    if (maxRewardNumberRule && getReferrerRewardCount(referrer, referrerRewardKeys) >= maxRewardNumberRule.rewardLimit) {
        console.log("referrER made too many referrals");
        transaction.generateEmail({emailKey:"rewardLimitReached", user: referrer, referralId, query: emailQuery});
        return false;
    }

    const rewardedReferrer = referrerRewards.some(r => (r.referralId === referralId));

    if (rewardedReferrer) {
      console.log("referrer rewarded for this referral");
      return false;
    }
    return true;
}

const handleUserUpsert = function (transaction) {
    console.log(transaction.context.body.activeTrigger.type);
    const trigger = transaction.context.body.activeTrigger;
    const user = trigger.user;
    const referred = user;

    if ( referred && user.referredByReferral) {
        //console.log("fire for userUpsert");
        const referrer = user.referredByReferral.referrerUser;
        fireProgramEvalAnalytics(transaction, referrer);
        fireProgramEvalAnalytics(transaction, referred);
    }
    generateRewardAndEmail(transaction);

}

const handleUserEvent = function (transaction) {
    console.log(transaction.context.body.activeTrigger.type);
    const trigger = transaction.context.body.activeTrigger;
    const user = trigger.user;
    const referred = user;
    const rules = transaction.context.body.program.rules;
    if ( referred && user.referredByReferral) {
        const events = trigger.events;
        const referrer = user.referredByReferral.referrerUser;
        if (rules.conversionRules.selectedRule && !referrer.dateBlocked) {
            //console.log("fire for purchase");
            fireProgramEvalAnalytics(transaction, referrer);
            fireProgramEvalAnalytics(transaction, referred);
        }
    }
    generateRewardAndEmail(transaction);
}

const handleReferralTrigger = function (transaction) {
    console.log(transaction.context.body.activeTrigger.type);
    //generate email - referral started
    const trigger = transaction.context.body.activeTrigger;
    const user = trigger.user;
    const referred = user;
    const referrer = user.referredByReferral.referrerUser;
    const referralId = trigger.referral.id;
    const rules = transaction.context.body.program.rules;
    //push Analytics
    //console.log("fire for Referral");
    fireProgramEvalAnalytics(transaction, referrer);
    fireProgramEvalAnalytics(transaction, referred);
    if (rules.programRewardRules.rewardReferred.rewardOnConversionOrReferral) { //true for reward on referral
       generateRewardAndEmail(transaction);
    } else {
      transaction.generateEmail({emailKey:"referralStarted", user, referralId, query:emailQuery});
    }
}

const handleIntrospection = function (template, rules) { //template: based on contentful
    //only include reward limit email when max number of rewards rule is selected
    const maxNumberSelected = rules.programRewardRules.maxRewardNumber.maxNumber;
    const rewardReferred = rules.programRewardRules.rewardReferred.rewardReferredUser;
    //get reward limit email
    const rewardLimitEmail = {
            "key": "rewardLimitReached",
            "name": "Reach reward limit",
            "defaults": "4nDHXzIemA6IqkSKsK40Q0",
            "description": "We send this email when a referrer reaches the max number of rewards."
    };
    const referredReward = {
            "key": "referredReward",
            "name": "Referred Reward",
            "description": "The reward given to new users that have been referred"
    };
    let newTemplate = template;
    if(maxNumberSelected && !template.emails.includes(email => email.key === 'rewardLimitReached')) {
        newTemplate.emails = [...template.emails, rewardLimitEmail];
    } else {
      const limitEmailRemoved = newTemplate.emails.filter(email => email.key !== 'rewardLimitReached');
      newTemplate.emails = limitEmailRemoved.splice(0);
    }
    if(!rewardReferred) {
        const referredRewardRemoved = newTemplate.rewards.filter(reward => reward.key !== 'referredReward');
        newTemplate.rewards = referredRewardRemoved.splice(0);
    } else if (!template.rewards.includes(reward => reward.key === 'referredReward'))  {
        newTemplate.rewards = [...template.rewards,referredReward];
    }
    return newTemplate;
}

function generateRewardAndEmail (transaction) {
    const user = transaction.context.body.activeTrigger.user;
    if(shouldRewardReferreD(transaction)) {
        console.log("reward referred user");
        const referralId = user.referredByReferral.id;
        transaction.generateReferralRewardAndEmail({emailKey: "referredRewardReceived", rewardKey: "referredReward",referralId: referralId, user:user, query: emailQuery});
    }
    if(shouldRewardReferreR(transaction)) {
        const referrer = user.referredByReferral.referrerUser;
        const referralId = user.referredByReferral.id;
        console.log("give referrer reward");
        transaction.generateReferralRewardAndEmail({emailKey: "referralCompleted", rewardKey: "referrerReward", referralId, user: referrer, query: emailQuery});
    }
}

function parseValue(value) {
    if (/^(\-|\+)?([0-9]+(\.[0-9]+)?)$/
      .test(value)) {
      return Number(value);
    }

    if (value.toLowerCase() === "true" || "yes") {
      return Boolean(true);
    }
    if (value.toLowerCase() === "false" || "no") {
      return Boolean(false);
    }
    return value;
}

module.exports = boilerplate.webtask(
    {
      "AFTER_USER_CREATED_OR_UPDATED" : handleUserUpsert,
      "AFTER_USER_EVENT_PROCESSED": handleUserEvent,
      "REFERRAL": handleReferralTrigger,
      "PROGRAM_INTROSPECTION": handleIntrospection
    }
);
