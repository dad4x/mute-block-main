const browser = require('webextension-polyfill')
const defaults = require('./defaults')

function sendTabMessage(tabId, message) {
    return browser.tabs.sendMessage(tabId, message).catch(error => {
        if(/Receiving end does not exist/i.test(error?.message || '')) return
        console.warn('tabs.sendMessage failed', {tabId, message, error})
    })
}

browser.runtime.onInstalled.addListener(details => {
    if(details.reason === 'install') {
        browser.storage.local.set(defaults)
    }
})

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.action === 'create-tab') {
        browser.tabs.create({url: request.url, active: false})
    }
    else if(request.action === 'close-tab') {
        browser.tabs.remove(sender.tab.id)
    }
})

browser.webRequest.onCompleted.addListener(details => {
    if(details.url.match(/TribePeopleModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-people-modal-loaded'})
    }
    else if(details.url.match(/TribeContributorOrHigherListQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-contributors-loaded'})
    }
    else if(details.url.match(/UserProfileFollowersModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-modal-loaded'})
    }
    else if(details.url.match(/UserProfileFollowers_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-loaded'})
    }
    else if(details.url.match(/UserProfileFollowingPeople_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-following-loaded'})
    }
    else if(details.url.match(/userBlockModalInnerUtils_userSetBlock_Mutation/i)) {
        sendTabMessage(details.tabId, {status: 'profile-block-updated'})
    }
    else if(details.url.match(/ContentLogMainQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-log-loaded'})
    }
    else if(details.url.match(/QuestionCollapsedAnswerLoaderQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-page-loaded'})
    }
},
{
    urls: [
        'https://*.quora.com/graphql/gql_para_POST?q=TribePeopleModalQuery',
        'https://*.quora.com/graphql/gql_para_POST?q=TribeContributorOrHigherListQuery',

        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowersModalQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowers_ProfileTopics_Query',
        'https://www.quora.com/graphql/gql_POST?q=userBlockModalInnerUtils_userSetBlock_Mutation',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowingPeople_ProfileTopics_Query',

        'https://www.quora.com/graphql/gql_para_POST?q=ContentLogMainQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=QuestionCollapsedAnswerLoaderQuery'
    ]
})
