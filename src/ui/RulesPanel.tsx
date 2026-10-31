import { useId } from 'react';
import { useT, useTagName } from '../i18n';
import { useStore } from '../store';
import type { AccessRule } from '../types';
import { useAllTags } from './common';

function RuleRow({ rule }: { rule: AccessRule }) {
  const t = useT();
  const tg = useTagName();
  const updateRule = useStore((s) => s.updateRule);
  const removeRule = useStore((s) => s.removeRule);
  const persons = useStore((s) => s.persons);
  const floors = useStore((s) => s.building.floors);
  const { personTags, spaceTags } = useAllTags();
  const pList = useId();
  const sList = useId();

  const only = rule.mode === 'only';
  // Personas a las que la regla les impide el paso: con la etiqueta (deny) o sin ella (only)
  const affectedP = rule.personTag ? persons.filter((p) => p.tags.includes(rule.personTag) !== only).length : 0;
  const affectedS = rule.spaceTag
    ? floors.reduce((acc, f) => acc + f.spaces.filter((s) => s.tags.includes(rule.spaceTag)).length, 0)
    : 0;

  return (
    <div className="card rule">
      <div className="rule-line">
        <input
          list={pList}
          placeholder={t('personTag')}
          value={rule.personTag}
          onChange={(e) => updateRule(rule.id, { personTag: e.target.value.trim().toLowerCase() })}
        />
        <select
          className={`rule-verb ${rule.mode ?? 'deny'}`}
          value={rule.mode ?? 'deny'}
          onChange={(e) => updateRule(rule.id, { mode: e.target.value as AccessRule['mode'] })}
        >
          <option value="deny">⛔ {t('cannotEnter')}</option>
          <option value="avoid">⚠️ {t('avoidIfPossible')}</option>
          <option value="only">✅ {t('onlyCanUse')}</option>
        </select>
        <input
          list={sList}
          placeholder={t('spaceTag')}
          value={rule.spaceTag}
          onChange={(e) => updateRule(rule.id, { spaceTag: e.target.value.trim().toLowerCase() })}
        />
        <button className="icon danger" title={t('remove')} onClick={() => removeRule(rule.id)}>
          ✕
        </button>
      </div>
      <datalist id={pList}>
        {personTags.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id={sList}>
        {spaceTags.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <p className="muted small">
        {/* Las etiquetas se guardan en español: en inglés se muestra su traducción */}
        {(tg(rule.personTag) !== rule.personTag || tg(rule.spaceTag) !== rule.spaceTag) &&
          `${tg(rule.personTag)} → ${tg(rule.spaceTag)} · `}
        {t('ruleAffects', { p: affectedP, s: affectedS })}
      </p>
    </div>
  );
}

export default function RulesPanel() {
  const t = useT();
  const tg = useTagName();
  const rules = useStore((s) => s.rules);
  const addRule = useStore((s) => s.addRule);
  const { personTags, spaceTags } = useAllTags();
  return (
    <div className="panel">
      <p className="intro">{t('rulesIntro')}</p>
      {rules.length === 0 && <p className="muted">{t('noRules')}</p>}
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
      <button className="btn primary block" onClick={addRule}>
        {t('addRule')}
      </button>
      <h4>{t('personTagsInUse')}</h4>
      <div className="chips">
        {personTags.length ? personTags.map((x) => <span key={x} className="chip">{tg(x)}</span>) : <span className="muted">{t('none')}</span>}
      </div>
      <h4>{t('spaceTagsInUse')}</h4>
      <div className="chips">
        {spaceTags.length ? spaceTags.map((x) => <span key={x} className="chip">{tg(x)}</span>) : <span className="muted">{t('none')}</span>}
      </div>
    </div>
  );
}
