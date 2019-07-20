import {MDCList} from '@material/list';
import {MDCRipple} from '@material/ripple';

const list = new MDCList(document.querySelector('.mdc-list-group'));
const listItemRipples = list.listElements.map((listItemEl) => new MDCRipple(listItemEl));

document.getElementById("github").onclick = function() {
    window.open("https://github.com/umechanhika", "_blank");
};

document.getElementById("GooglePlay").onclick = function() {
    window.open("https://play.google.com/store/apps/dev?id=5250267109563010314", "_blank");
};

document.getElementById("Qiita").onclick = function() {
    window.open("https://qiita.com/umechanhika", "_blank");
};

document.getElementById("note").onclick = function() {
    window.open("https://note.mu/umechanhika", "_blank");
};

document.getElementById("SpeakerDeck").onclick = function() {
    window.open("https://speakerdeck.com/umechanhika", "_blank");
};

document.getElementById("Twitter").onclick = function() {
    window.open("https://twitter.com/umechanhika", "_blank");
};

document.getElementById("LinkedIn").onclick = function() {
    window.open("https://www.linkedin.com/in/umechanhika", "_blank");
};
